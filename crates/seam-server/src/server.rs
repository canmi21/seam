use std::collections::HashMap;
use std::sync::Arc;

use axum::extract::{Path, State};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::Router;
use tokio::net::TcpListener;

use crate::errors::SeamError;
use crate::manifest::build_manifest;
use crate::procedure::ProcedureDef;

struct AppState {
  manifest_json: serde_json::Value,
  handlers: HashMap<String, Arc<ProcedureDef>>,
}

pub struct SeamServer {
  procedures: Vec<ProcedureDef>,
}

impl SeamServer {
  pub fn new() -> Self {
    Self { procedures: Vec::new() }
  }

  pub fn procedure(mut self, proc: ProcedureDef) -> Self {
    self.procedures.push(proc);
    self
  }

  pub fn into_router(self) -> Router {
    let manifest = build_manifest(&self.procedures);
    let manifest_json = serde_json::to_value(&manifest).expect("manifest serialization");

    let mut handlers = HashMap::new();
    for proc in self.procedures {
      handlers.insert(proc.name.clone(), Arc::new(proc));
    }

    let state = Arc::new(AppState { manifest_json, handlers });

    Router::new()
      .route("/seam/manifest.json", get(handle_manifest))
      .route("/seam/rpc/{name}", post(handle_rpc))
      .with_state(state)
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
