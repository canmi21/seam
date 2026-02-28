/* packages/server/adapter/axum/src/handler.rs */

use std::collections::HashMap;
use std::convert::Infallible;
use std::pin::Pin;
use std::sync::Arc;

use axum::extract::{MatchedPath, Path, Query, State};
use axum::response::sse::{Event, Sse};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::{get, post};
use axum::Router;
use futures_core::Stream;
use seam_server::page::PageDef;
use seam_server::procedure::{ProcedureDef, ProcedureType, SubscriptionDef};
use seam_server::resolve::ResolveStrategy;
use seam_server::{RpcHashMap, SeamError};
use tokio::task::JoinSet;
use tokio_stream::StreamExt;

use crate::error::AxumError;

pub(crate) struct AppState {
  pub manifest_json: serde_json::Value,
  pub handlers: HashMap<String, Arc<ProcedureDef>>,
  pub subscriptions: HashMap<String, Arc<SubscriptionDef>>,
  pub pages: HashMap<String, Arc<PageDef>>,
  pub rpc_hash_map: Option<HashMap<String, String>>,
  pub batch_hash: Option<String>,
  pub i18n_config: Option<seam_server::I18nConfig>,
  pub locale_set: Option<std::collections::HashSet<String>>,
  pub strategies: Vec<Box<dyn ResolveStrategy>>,
}

pub(crate) fn build_router(
  manifest_json: serde_json::Value,
  mut handlers: HashMap<String, Arc<ProcedureDef>>,
  subscriptions: HashMap<String, Arc<SubscriptionDef>>,
  pages: Vec<PageDef>,
  hash_map: Option<RpcHashMap>,
  i18n_config: Option<seam_server::I18nConfig>,
  strategies: Vec<Box<dyn ResolveStrategy>>,
) -> Router {
  let (rpc_hash_map, batch_hash) = match hash_map {
    Some(m) => {
      let mut rev = m.reverse_lookup();
      // Built-in procedures bypass hash obfuscation (identity mapping)
      rev.insert("__seam_i18n_query".to_string(), "__seam_i18n_query".to_string());
      (Some(rev), Some(m.batch))
    }
    None => (None, None),
  };

  let locale_set = i18n_config
    .as_ref()
    .map(|c| c.locales.iter().cloned().collect::<std::collections::HashSet<_>>());

  // Use default strategies when none provided
  let strategies =
    if strategies.is_empty() { seam_server::default_strategies() } else { strategies };

  let has_url_prefix = strategies.iter().any(|s| s.kind() == "url_prefix");

  // Register built-in __seam_i18n_query procedure (route-hash-based lookup)
  if let Some(ref i18n) = i18n_config {
    let i18n_clone = i18n.clone();
    handlers.insert(
      "__seam_i18n_query".to_string(),
      Arc::new(ProcedureDef {
        name: "__seam_i18n_query".to_string(),
        proc_type: ProcedureType::Query,
        input_schema: serde_json::json!({}),
        output_schema: serde_json::json!({}),
        error_schema: None,
        handler: Arc::new(move |input: serde_json::Value| {
          let i18n = i18n_clone.clone();
          Box::pin(async move {
            let route_hash = input.get("route").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let locale =
              input.get("locale").and_then(|v| v.as_str()).unwrap_or(&i18n.default).to_string();

            let messages = lookup_i18n_messages(&i18n, &route_hash, &locale);
            let hash = i18n
              .content_hashes
              .get(&route_hash)
              .and_then(|m| m.get(&locale))
              .cloned()
              .unwrap_or_default();

            Ok(serde_json::json!({ "hash": hash, "messages": messages }))
          })
        }),
      }),
    );
  }

  let mut page_map = HashMap::new();
  let mut router = Router::new()
    .route("/_seam/manifest.json", get(handle_manifest))
    .route("/_seam/procedure/{name}", post(handle_rpc).get(handle_subscribe));

  // Pages are served under /_seam/page/* prefix only.
  // Root-path page serving (e.g. "/" or "/dashboard/:id") is the application's
  // responsibility — use Router::fallback to forward unmatched GET requests
  // to /_seam/page/* via tower::ServiceExt::oneshot. See the github-dashboard
  // rust-axum example for the pattern.
  for page in pages {
    let full_route = format!("/_seam/page{}", page.route);
    let page_arc = Arc::new(page);
    page_map.insert(full_route.clone(), page_arc.clone());
    router = router.route(&full_route, get(handle_page));

    // Register locale-prefixed routes only when url_prefix strategy is active
    if has_url_prefix {
      let locale_route = format!("/_seam/page/{{_seam_locale}}{}", page_arc.route);
      page_map.insert(locale_route.clone(), page_arc.clone());
      router = router.route(&locale_route, get(handle_page));
    }
  }

  let state = Arc::new(AppState {
    manifest_json,
    handlers,
    subscriptions,
    pages: page_map,
    rpc_hash_map,
    batch_hash,
    i18n_config,
    locale_set,
    strategies,
  });

  router.with_state(state)
}

async fn handle_manifest(
  State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, AxumError> {
  if state.rpc_hash_map.is_some() {
    return Err(SeamError::forbidden("Manifest disabled").into());
  }
  Ok(axum::Json(state.manifest_json.clone()))
}

async fn handle_rpc(
  State(state): State<Arc<AppState>>,
  Path(name): Path<String>,
  body: axum::body::Bytes,
) -> Result<Response, AxumError> {
  // Batch: match both original "_batch" and hashed batch endpoint
  if name == "_batch" || state.batch_hash.as_deref() == Some(&name) {
    return handle_batch(State(state), body).await;
  }

  // Resolve hash -> original name when obfuscation is active
  let resolved = if let Some(ref map) = state.rpc_hash_map {
    map.get(&name).cloned().ok_or_else(|| SeamError::not_found("Not found"))?
  } else {
    name.clone()
  };

  let proc = state
    .handlers
    .get(&resolved)
    .ok_or_else(|| SeamError::not_found(format!("Procedure '{resolved}' not found")))?;

  let input: serde_json::Value =
    serde_json::from_slice(&body).map_err(|e| SeamError::validation(e.to_string()))?;

  let result = (proc.handler)(input).await?;
  Ok(axum::Json(serde_json::json!({"ok": true, "data": result})).into_response())
}

#[derive(serde::Deserialize)]
struct BatchRequest {
  calls: Vec<BatchCall>,
}

#[derive(serde::Deserialize)]
struct BatchCall {
  procedure: String,
  #[serde(default)]
  input: serde_json::Value,
}

#[derive(serde::Serialize)]
#[serde(untagged)]
enum BatchResultItem {
  Ok { ok: bool, data: serde_json::Value },
  Err { ok: bool, error: BatchError },
}

#[derive(serde::Serialize)]
struct BatchError {
  code: String,
  message: String,
  transient: bool,
}

async fn handle_batch(
  State(state): State<Arc<AppState>>,
  body: axum::body::Bytes,
) -> Result<Response, AxumError> {
  let batch: BatchRequest = serde_json::from_slice(&body)
    .map_err(|_| SeamError::validation("Batch request must have a 'calls' array"))?;

  let mut join_set = JoinSet::new();
  for (idx, call) in batch.calls.into_iter().enumerate() {
    let state = state.clone();
    join_set.spawn(async move {
      // Resolve hash -> original name
      let proc_name = if let Some(ref map) = state.rpc_hash_map {
        map.get(&call.procedure).cloned().unwrap_or(call.procedure)
      } else {
        call.procedure
      };

      let result = match state.handlers.get(&proc_name) {
        Some(proc) => match (proc.handler)(call.input).await {
          Ok(data) => BatchResultItem::Ok { ok: true, data },
          Err(e) => BatchResultItem::Err {
            ok: false,
            error: BatchError {
              code: e.code().to_string(),
              message: e.message().to_string(),
              transient: false,
            },
          },
        },
        None => BatchResultItem::Err {
          ok: false,
          error: BatchError {
            code: "NOT_FOUND".to_string(),
            message: format!("Procedure '{proc_name}' not found"),
            transient: false,
          },
        },
      };
      (idx, result)
    });
  }

  // Collect results preserving original order
  let mut indexed: Vec<(usize, BatchResultItem)> = Vec::new();
  while let Some(result) = join_set.join_next().await {
    let (idx, item) = result.map_err(|e| SeamError::internal(e.to_string()))?;
    indexed.push((idx, item));
  }
  indexed.sort_by_key(|(i, _)| *i);
  let results: Vec<BatchResultItem> = indexed.into_iter().map(|(_, item)| item).collect();

  Ok(axum::Json(serde_json::json!({ "ok": true, "data": { "results": results } })).into_response())
}

#[derive(serde::Deserialize)]
struct SubscribeQuery {
  input: Option<String>,
}

async fn handle_subscribe(
  State(state): State<Arc<AppState>>,
  Path(name): Path<String>,
  Query(query): Query<SubscribeQuery>,
) -> Sse<Pin<Box<dyn Stream<Item = Result<Event, Infallible>> + Send>>> {
  let setup = async {
    // Resolve hash -> original name for subscriptions
    let resolved = if let Some(ref map) = state.rpc_hash_map {
      map.get(&name).cloned().ok_or_else(|| SeamError::not_found("Not found"))?
    } else {
      name.clone()
    };

    let sub = state
      .subscriptions
      .get(&resolved)
      .ok_or_else(|| SeamError::not_found(format!("Subscription '{resolved}' not found")))?;

    let raw_input = match &query.input {
      Some(s) => serde_json::from_str(s).map_err(|e| SeamError::validation(e.to_string()))?,
      None => serde_json::Value::Object(serde_json::Map::new()),
    };

    let data_stream = (sub.handler)(raw_input).await?;
    Ok::<_, SeamError>(data_stream)
  };

  match setup.await {
    Ok(data_stream) => {
      let event_stream = data_stream
        .map(|item| match item {
          Ok(value) => {
            let data = serde_json::to_string(&value).unwrap_or_default();
            Ok(Event::default().event("data").data(data))
          }
          Err(e) => {
            let payload =
              serde_json::json!({ "code": e.code(), "message": e.message(), "transient": false });
            Ok(Event::default().event("error").data(payload.to_string()))
          }
        })
        .chain(tokio_stream::once(Ok(Event::default().event("complete").data("{}"))));
      Sse::new(Box::pin(event_stream))
    }
    Err(err) => {
      let payload =
        serde_json::json!({ "code": err.code(), "message": err.message(), "transient": false });
      let error_event = Event::default().event("error").data(payload.to_string());
      Sse::new(Box::pin(tokio_stream::once(Ok(error_event))))
    }
  }
}

/// Look up pre-resolved messages by route hash + locale. Zero merge, zero filter.
fn lookup_i18n_messages(
  i18n: &seam_server::I18nConfig,
  route_hash: &str,
  locale: &str,
) -> serde_json::Value {
  // Paged mode: read from disk
  if i18n.mode == "paged" {
    if let Some(ref dist_dir) = i18n.dist_dir {
      let path = dist_dir.join("i18n").join(route_hash).join(format!("{locale}.json"));
      if let Ok(content) = std::fs::read_to_string(&path) {
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content) {
          return parsed;
        }
      }
    }
    return serde_json::Value::Object(Default::default());
  }

  // Memory mode: direct lookup
  i18n
    .messages
    .get(locale)
    .and_then(|route_msgs| route_msgs.get(route_hash))
    .cloned()
    .unwrap_or(serde_json::Value::Object(Default::default()))
}

#[allow(clippy::too_many_lines)]
async fn handle_page(
  State(state): State<Arc<AppState>>,
  matched: MatchedPath,
  uri: axum::http::Uri,
  headers: axum::http::HeaderMap,
  Path(mut params): Path<HashMap<String, String>>,
) -> Result<Html<String>, AxumError> {
  let route_pattern = matched.as_str().to_string();
  let page =
    state.pages.get(&route_pattern).ok_or_else(|| SeamError::not_found("Page not found"))?;

  // Resolve locale when i18n is active
  let locale = if let Some(ref locale_set) = state.locale_set {
    let extracted = params.remove("_seam_locale");
    match extracted {
      Some(ref loc) if !locale_set.contains(loc) => {
        return Err(SeamError::not_found("Unknown locale").into());
      }
      _ => {}
    }
    let i18n = state.i18n_config.as_ref().unwrap();
    let url_str = uri.path_and_query().map(|pq| pq.as_str()).unwrap_or("");
    let data = seam_server::ResolveData {
      url: url_str,
      path_locale: extracted.as_deref(),
      cookie_header: headers.get(axum::http::header::COOKIE).and_then(|v| v.to_str().ok()),
      accept_language: headers
        .get(axum::http::header::ACCEPT_LANGUAGE)
        .and_then(|v| v.to_str().ok()),
      locales: &i18n.locales,
      default_locale: &i18n.default,
    };
    Some(seam_server::resolve_chain(&state.strategies, &data))
  } else {
    None
  };

  // Select locale-specific template (pre-resolved with layout chain)
  let template = if let Some(ref loc) = locale {
    page
      .locale_templates
      .as_ref()
      .and_then(|lt| lt.get(loc))
      .map(|s| s.as_str())
      .unwrap_or(&page.template)
  } else {
    &page.template
  };

  let mut join_set = JoinSet::new();

  let handlers = state.handlers.clone();
  for loader in &page.loaders {
    let input = (loader.input_fn)(&params);
    let proc_name = loader.procedure.clone();
    let data_key = loader.data_key.clone();
    let handlers = handlers.clone();

    join_set.spawn(async move {
      let proc = handlers
        .get(&proc_name)
        .ok_or_else(|| SeamError::internal(format!("Procedure '{proc_name}' not found")))?;
      let result = (proc.handler)(input).await?;
      Ok::<(String, serde_json::Value), SeamError>((data_key, result))
    });
  }

  let mut data = serde_json::Map::new();
  while let Some(result) = join_set.join_next().await {
    let (key, value) = result
      .map_err(|e| SeamError::internal(e.to_string()))? // JoinError -> Internal (task panic)
      ?; // SeamError propagates unchanged
    data.insert(key, value);
  }

  // Flatten keyed loader results for slot resolution: spread nested object
  // values to the top level so slots like <!--seam:tagline--> can resolve from
  // data like {page: {tagline: "..."}} (matching TS `flattenForSlots`).
  let mut inject_map = data.clone();
  for value in data.values() {
    if let serde_json::Value::Object(nested) = value {
      for (nk, nv) in nested {
        inject_map.entry(nk.clone()).or_insert_with(|| nv.clone());
      }
    }
  }
  let inject_data = serde_json::Value::Object(inject_map);
  let mut html = seam_injector::inject_no_script(template, &inject_data);

  // Build data script JSON: page data at top level, layout data under _layouts (per-layout grouping)
  let mut script_data = serde_json::Map::new();
  if !page.layout_chain.is_empty() {
    // Collect all layout-claimed keys
    let mut claimed_keys = std::collections::HashSet::new();
    for entry in &page.layout_chain {
      for key in &entry.loader_keys {
        claimed_keys.insert(key.as_str());
      }
    }

    // Page data = keys not claimed by any layout
    for (k, v) in &data {
      if !claimed_keys.contains(k.as_str()) {
        script_data.insert(k.clone(), v.clone());
      }
    }

    // Build per-layout _layouts grouping
    let mut layouts_map = serde_json::Map::new();
    for entry in &page.layout_chain {
      let mut layout_data = serde_json::Map::new();
      for key in &entry.loader_keys {
        if let Some(v) = data.get(key) {
          layout_data.insert(key.clone(), v.clone());
        }
      }
      if !layout_data.is_empty() {
        layouts_map.insert(entry.id.clone(), serde_json::Value::Object(layout_data));
      }
    }
    if !layouts_map.is_empty() {
      script_data.insert("_layouts".to_string(), serde_json::Value::Object(layouts_map));
    }
  } else {
    script_data = data;
  }

  // Inject _i18n data for client hydration (hash-based lookup — zero merge, zero filter)
  if let (Some(ref loc), Some(ref i18n)) = (&locale, &state.i18n_config) {
    let route_hash = i18n.route_hashes.get(&page.route).cloned().unwrap_or_default();
    let messages = lookup_i18n_messages(i18n, &route_hash, loc);

    let mut i18n_data = serde_json::Map::new();
    i18n_data.insert("locale".into(), serde_json::Value::String(loc.clone()));
    i18n_data.insert("messages".into(), messages);

    // Inject content hash and router table when cache is enabled
    if i18n.cache && !route_hash.is_empty() {
      if let Some(hash) = i18n.content_hashes.get(&route_hash).and_then(|m| m.get(loc)) {
        i18n_data.insert("hash".into(), serde_json::Value::String(hash.clone()));
      }
      if let Ok(router) = serde_json::to_value(&i18n.content_hashes) {
        i18n_data.insert("router".into(), router);
      }
    }

    script_data.insert("_i18n".into(), serde_json::Value::Object(i18n_data));
  }

  let json = serde_json::to_string(&serde_json::Value::Object(script_data)).unwrap_or_default();
  let escaped = seam_server::ascii_escape_json(&json);
  let script =
    format!(r#"<script id="{}" type="application/json">{}</script>"#, page.data_id, escaped,);
  if let Some(pos) = html.rfind("</body>") {
    html.insert_str(pos, &script);
  } else {
    html.push_str(&script);
  }

  // Set <html lang="..."> attribute
  if let Some(ref loc) = locale {
    html = html.replacen("<html", &format!("<html lang=\"{loc}\""), 1);
  }

  Ok(Html(html))
}
