/* src/server/adapter/axum/src/handler/rpc.rs */

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::response::{IntoResponse, Response};
use seam_server::SeamError;
use tokio::task::JoinSet;

use super::AppState;
use crate::error::AxumError;

pub(super) async fn handle_manifest(
  State(state): State<Arc<AppState>>,
) -> Result<impl IntoResponse, AxumError> {
  if state.rpc_hash_map.is_some() {
    return Err(SeamError::forbidden("Manifest disabled").into());
  }
  Ok(axum::Json(state.manifest_json.clone()))
}

pub(super) async fn handle_rpc(
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
