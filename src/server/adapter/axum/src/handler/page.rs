/* src/server/adapter/axum/src/handler/page.rs */

use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::{MatchedPath, Path, State};
use axum::response::Html;
use seam_server::page::PageDef;
use seam_server::procedure::ProcedureDef;
use seam_server::SeamError;
use tokio::task::JoinSet;

use super::{lookup_i18n_messages, AppState};
use crate::error::AxumError;

/// Resolve locale from request using the configured strategy chain.
fn resolve_locale(
  state: &AppState,
  params: &mut HashMap<String, String>,
  uri: &axum::http::Uri,
  headers: &axum::http::HeaderMap,
) -> Result<Option<String>, SeamError> {
  let locale_set = match state.locale_set {
    Some(ref ls) => ls,
    None => return Ok(None),
  };

  let extracted = params.remove("_seam_locale");
  if let Some(ref loc) = extracted {
    if !locale_set.contains(loc) {
      return Err(SeamError::not_found("Unknown locale"));
    }
  }

  let i18n = state.i18n_config.as_ref().unwrap();
  let url_str = uri.path_and_query().map(|pq| pq.as_str()).unwrap_or("");
  let data = seam_server::ResolveData {
    url: url_str,
    path_locale: extracted.as_deref(),
    cookie_header: headers.get(axum::http::header::COOKIE).and_then(|v| v.to_str().ok()),
    accept_language: headers.get(axum::http::header::ACCEPT_LANGUAGE).and_then(|v| v.to_str().ok()),
    locales: &i18n.locales,
    default_locale: &i18n.default,
  };
  Ok(Some(seam_server::resolve_chain(&state.strategies, &data)))
}

/// Run page loaders concurrently and collect keyed results.
async fn run_loaders(
  handlers: &HashMap<String, Arc<ProcedureDef>>,
  page: &PageDef,
  params: &HashMap<String, String>,
) -> Result<serde_json::Map<String, serde_json::Value>, SeamError> {
  let mut join_set = JoinSet::new();

  for loader in &page.loaders {
    let input = (loader.input_fn)(params);
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
  Ok(data)
}

/// Build the client-side script data JSON, grouping layout-claimed keys under `_layouts`.
fn build_script_data(
  data: &serde_json::Map<String, serde_json::Value>,
  page: &PageDef,
) -> serde_json::Map<String, serde_json::Value> {
  if page.layout_chain.is_empty() {
    return data.clone();
  }

  let mut claimed_keys = std::collections::HashSet::new();
  for entry in &page.layout_chain {
    for key in &entry.loader_keys {
      claimed_keys.insert(key.as_str());
    }
  }

  // Page data = keys not claimed by any layout
  let mut script_data = serde_json::Map::new();
  for (k, v) in data {
    if !claimed_keys.contains(k.as_str()) {
      script_data.insert(k.clone(), v.clone());
    }
  }

  // Per-layout _layouts grouping
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

  script_data
}

/// Inject _i18n data into script_data for client hydration.
fn inject_i18n_data(
  script_data: &mut serde_json::Map<String, serde_json::Value>,
  locale: &str,
  i18n: &seam_server::I18nConfig,
  route: &str,
) {
  let route_hash = i18n.route_hashes.get(route).cloned().unwrap_or_default();
  let messages = lookup_i18n_messages(i18n, &route_hash, locale);

  let mut i18n_data = serde_json::Map::new();
  i18n_data.insert("locale".into(), serde_json::Value::String(locale.to_string()));
  i18n_data.insert("messages".into(), messages);

  if i18n.cache && !route_hash.is_empty() {
    if let Some(hash) = i18n.content_hashes.get(&route_hash).and_then(|m| m.get(locale)) {
      i18n_data.insert("hash".into(), serde_json::Value::String(hash.clone()));
    }
    if let Ok(router) = serde_json::to_value(&i18n.content_hashes) {
      i18n_data.insert("router".into(), router);
    }
  }

  script_data.insert("_i18n".into(), serde_json::Value::Object(i18n_data));
}

pub(super) async fn handle_page(
  State(state): State<Arc<AppState>>,
  matched: MatchedPath,
  uri: axum::http::Uri,
  headers: axum::http::HeaderMap,
  Path(mut params): Path<HashMap<String, String>>,
) -> Result<Html<String>, AxumError> {
  let route_pattern = matched.as_str().to_string();
  let page =
    state.pages.get(&route_pattern).ok_or_else(|| SeamError::not_found("Page not found"))?;

  let locale = resolve_locale(&state, &mut params, &uri, &headers)?;

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

  let data = run_loaders(&state.handlers, page, &params).await?;

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

  let mut script_data = build_script_data(&data, page);

  if let (Some(ref loc), Some(ref i18n)) = (&locale, &state.i18n_config) {
    inject_i18n_data(&mut script_data, loc, i18n, &page.route);
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

  if let Some(ref loc) = locale {
    html = html.replacen("<html", &format!("<html lang=\"{loc}\""), 1);
  }

  Ok(Html(html))
}
