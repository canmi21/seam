/* packages/server/core/rust/src/server.rs */

use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::{MatchedPath, Path, State};
use axum::response::{Html, IntoResponse};
use axum::routing::{get, post};
use axum::Router;
use tokio::net::TcpListener;
use tokio::task::JoinSet;

use crate::errors::SeamError;
use crate::injector;
use crate::manifest::build_manifest;
use crate::page::PageDef;
use crate::procedure::ProcedureDef;

struct AppState {
  manifest_json: serde_json::Value,
  handlers: HashMap<String, Arc<ProcedureDef>>,
  pages: HashMap<String, Arc<PageDef>>,
}

pub struct SeamServer {
  procedures: Vec<ProcedureDef>,
  pages: Vec<PageDef>,
}

impl SeamServer {
  pub fn new() -> Self {
    Self { procedures: Vec::new(), pages: Vec::new() }
  }

  pub fn procedure(mut self, proc: ProcedureDef) -> Self {
    self.procedures.push(proc);
    self
  }

  pub fn page(mut self, page: PageDef) -> Self {
    self.pages.push(page);
    self
  }

  pub fn into_router(self) -> Router {
    let manifest = build_manifest(&self.procedures);
    let manifest_json = serde_json::to_value(&manifest).expect("manifest serialization");

    let handlers: HashMap<String, Arc<ProcedureDef>> =
      self.procedures.into_iter().map(|p| (p.name.clone(), Arc::new(p))).collect();

    let mut pages = HashMap::new();
    let mut router = Router::new()
      .route("/seam/manifest.json", get(handle_manifest))
      .route("/seam/rpc/{name}", post(handle_rpc));

    for page in self.pages {
      let full_route = format!("/seam/page{}", page.route);
      pages.insert(full_route.clone(), Arc::new(page));
      router = router.route(&full_route, get(handle_page));
    }

    let state = Arc::new(AppState { manifest_json, handlers, pages });

    router.with_state(state)
  }

  pub async fn serve(self, addr: &str) -> Result<(), Box<dyn std::error::Error>> {
    let router = self.into_router();
    let listener = TcpListener::bind(addr).await?;
    println!("Seam Rust backend running on http://{addr}");
    axum::serve(listener, router).await?;
    Ok(())
  }
}

impl Default for SeamServer {
  fn default() -> Self {
    Self::new()
  }
}

async fn handle_manifest(State(state): State<Arc<AppState>>) -> impl IntoResponse {
  axum::Json(state.manifest_json.clone())
}

async fn handle_rpc(
  State(state): State<Arc<AppState>>,
  Path(name): Path<String>,
  body: axum::body::Bytes,
) -> Result<impl IntoResponse, SeamError> {
  let proc = state
    .handlers
    .get(&name)
    .ok_or_else(|| SeamError::not_found(format!("Procedure '{name}' not found")))?;

  let input: serde_json::Value =
    serde_json::from_slice(&body).map_err(|e| SeamError::validation(e.to_string()))?;

  let result = (proc.handler)(input).await?;
  Ok(axum::Json(result))
}

async fn handle_page(
  State(state): State<Arc<AppState>>,
  matched: MatchedPath,
  Path(params): Path<HashMap<String, String>>,
) -> Result<Html<String>, SeamError> {
  let route_pattern = matched.as_str().to_string();
  let page =
    state.pages.get(&route_pattern).ok_or_else(|| SeamError::not_found("Page not found"))?;

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

  let html = injector::inject(&page.template, &serde_json::Value::Object(data));
  Ok(Html(html))
}
