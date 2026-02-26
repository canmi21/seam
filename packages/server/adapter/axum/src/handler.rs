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
use seam_server::procedure::{ProcedureDef, SubscriptionDef};
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
}

pub(crate) fn build_router(
  manifest_json: serde_json::Value,
  handlers: HashMap<String, Arc<ProcedureDef>>,
  subscriptions: HashMap<String, Arc<SubscriptionDef>>,
  pages: Vec<PageDef>,
  hash_map: Option<RpcHashMap>,
  i18n_config: Option<seam_server::I18nConfig>,
) -> Router {
  let (rpc_hash_map, batch_hash) = match hash_map {
    Some(m) => (Some(m.reverse_lookup()), Some(m.batch)),
    None => (None, None),
  };

  let locale_set = i18n_config
    .as_ref()
    .map(|c| c.locales.iter().cloned().collect::<std::collections::HashSet<_>>());

  let mut page_map = HashMap::new();
  let mut router = Router::new()
    .route("/_seam/manifest.json", get(handle_manifest))
    .route("/_seam/rpc/{name}", post(handle_rpc))
    .route("/_seam/subscribe/{name}", get(handle_subscribe));

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

    // Register locale-prefixed routes when i18n is active
    if i18n_config.is_some() {
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
  Ok(axum::Json(result).into_response())
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
            error: BatchError { code: e.code().to_string(), message: e.message().to_string() },
          },
        },
        None => BatchResultItem::Err {
          ok: false,
          error: BatchError {
            code: "NOT_FOUND".to_string(),
            message: format!("Procedure '{proc_name}' not found"),
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

  Ok(axum::Json(serde_json::json!({ "results": results })).into_response())
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
            let payload = serde_json::json!({ "code": e.code(), "message": e.message() });
            Ok(Event::default().event("error").data(payload.to_string()))
          }
        })
        .chain(tokio_stream::once(Ok(Event::default().event("complete").data("{}"))));
      Sse::new(Box::pin(event_stream))
    }
    Err(err) => {
      let payload = serde_json::json!({ "code": err.code(), "message": err.message() });
      let error_event = Event::default().event("error").data(payload.to_string());
      Sse::new(Box::pin(tokio_stream::once(Ok(error_event))))
    }
  }
}

#[allow(clippy::too_many_lines)]
async fn handle_page(
  State(state): State<Arc<AppState>>,
  matched: MatchedPath,
  Path(mut params): Path<HashMap<String, String>>,
) -> Result<Html<String>, AxumError> {
  let route_pattern = matched.as_str().to_string();
  let page =
    state.pages.get(&route_pattern).ok_or_else(|| SeamError::not_found("Page not found"))?;

  // Extract locale from params when i18n is active
  let locale = if let Some(ref locale_set) = state.locale_set {
    let extracted = params.remove("_seam_locale");
    match extracted {
      Some(loc) if locale_set.contains(&loc) => Some(loc),
      Some(_) => return Err(SeamError::not_found("Unknown locale").into()),
      None => state.i18n_config.as_ref().map(|c| c.default.clone()),
    }
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

  // Build data script JSON: page data at top level, layout data under _layouts
  let mut script_data = serde_json::Map::new();
  if let Some(ref layout_id) = page.layout_id {
    let page_keys: std::collections::HashSet<&str> =
      page.page_loader_keys.iter().map(|s| s.as_str()).collect();
    let mut layout_data = serde_json::Map::new();
    for (k, v) in &data {
      if page_keys.contains(k.as_str()) {
        script_data.insert(k.clone(), v.clone());
      } else {
        layout_data.insert(k.clone(), v.clone());
      }
    }
    if !layout_data.is_empty() {
      let mut layouts_map = serde_json::Map::new();
      layouts_map.insert(layout_id.clone(), serde_json::Value::Object(layout_data));
      script_data.insert("_layouts".to_string(), serde_json::Value::Object(layouts_map));
    }
  } else {
    script_data = data;
  }

  // Inject _i18n data for client hydration
  if let (Some(ref loc), Some(ref i18n)) = (&locale, &state.i18n_config) {
    let mut i18n_data = serde_json::Map::new();
    i18n_data.insert("locale".into(), serde_json::Value::String(loc.clone()));
    i18n_data.insert(
      "messages".into(),
      i18n.messages.get(loc).cloned().unwrap_or(serde_json::Value::Object(Default::default())),
    );
    if loc != &i18n.default {
      i18n_data.insert(
        "fallbackMessages".into(),
        i18n
          .messages
          .get(&i18n.default)
          .cloned()
          .unwrap_or(serde_json::Value::Object(Default::default())),
      );
    }
    script_data.insert("_i18n".into(), serde_json::Value::Object(i18n_data));
  }

  let script = format!(
    r#"<script id="{}" type="application/json">{}</script>"#,
    page.data_id,
    serde_json::Value::Object(script_data),
  );
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
