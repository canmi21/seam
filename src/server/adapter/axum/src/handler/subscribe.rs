/* src/server/adapter/axum/src/handler/subscribe.rs */

use std::convert::Infallible;
use std::pin::Pin;
use std::sync::Arc;

use axum::extract::ws::WebSocketUpgrade;
use axum::extract::{FromRequestParts, Path, Query, State};
use axum::response::sse::{Event, Sse};
use axum::response::{IntoResponse, Response};
use futures_core::Stream;
use seam_server::SeamError;
use tokio_stream::StreamExt;

use super::AppState;
use super::channel::handle_channel_ws;

#[derive(serde::Deserialize)]
pub(super) struct SubscribeQuery {
  input: Option<String>,
}

pub(super) async fn handle_subscribe(
  State(state): State<Arc<AppState>>,
  Path(name): Path<String>,
  Query(query): Query<SubscribeQuery>,
  req: axum::extract::Request,
) -> Response {
  // WebSocket upgrade: extract from request parts if Upgrade header present
  if req
    .headers()
    .get("upgrade")
    .and_then(|v| v.to_str().ok())
    .is_some_and(|v| v.eq_ignore_ascii_case("websocket"))
  {
    let (mut parts, _body) = req.into_parts();
    if let Ok(ws) = WebSocketUpgrade::from_request_parts(&mut parts, &state).await {
      // Resolve hash -> original subscription name (e.g. "chat.events")
      let sub_name = if let Some(ref map) = state.rpc_hash_map {
        map.get(&name).cloned().unwrap_or(name.clone())
      } else {
        name.clone()
      };

      let raw_input = match &query.input {
        Some(s) => match serde_json::from_str(s) {
          Ok(v) => v,
          Err(e) => {
            let payload = serde_json::json!({
              "ok": false,
              "error": { "code": "VALIDATION_ERROR", "message": e.to_string(), "transient": false }
            });
            return axum::Json(payload).into_response();
          }
        },
        None => serde_json::Value::Object(serde_json::Map::new()),
      };

      return ws
        .on_upgrade(move |socket| handle_channel_ws(state, sub_name, raw_input, socket))
        .into_response();
    }
  }

  // SSE fallback path
  let sse_response = handle_subscribe_sse(state, name, query).await;
  sse_response.into_response()
}

async fn handle_subscribe_sse(
  state: Arc<AppState>,
  name: String,
  query: SubscribeQuery,
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
