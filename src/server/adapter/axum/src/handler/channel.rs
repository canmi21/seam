/* src/server/adapter/axum/src/handler/channel.rs */

use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket};
use futures_util::stream::SplitSink;
use futures_util::SinkExt;
use seam_server::SeamError;
use tokio::time::{interval, Duration};
use tokio_stream::StreamExt;

use super::AppState;

// --- WebSocket channel types ---

#[derive(serde::Deserialize)]
struct WsUplink {
  id: String,
  procedure: String,
  input: Option<serde_json::Value>,
}

#[derive(serde::Serialize)]
struct WsResponse {
  id: String,
  ok: bool,
  #[serde(skip_serializing_if = "Option::is_none")]
  data: Option<serde_json::Value>,
  #[serde(skip_serializing_if = "Option::is_none")]
  error: Option<WsError>,
}

#[derive(serde::Serialize)]
struct WsError {
  code: String,
  message: String,
  transient: bool,
}

fn merge_json_objects(base: &serde_json::Value, overlay: &serde_json::Value) -> serde_json::Value {
  match (base, overlay) {
    (serde_json::Value::Object(b), serde_json::Value::Object(o)) => {
      let mut merged = b.clone();
      for (k, v) in o {
        merged.insert(k.clone(), v.clone());
      }
      serde_json::Value::Object(merged)
    }
    _ => overlay.clone(),
  }
}

/// Validate and dispatch a single uplink command over the WebSocket channel.
async fn dispatch_ws_uplink(
  state: &AppState,
  channel_name: &str,
  channel_input: &serde_json::Value,
  text: &str,
  ws_sender: &mut SplitSink<WebSocket, Message>,
) {
  let uplink: WsUplink = match serde_json::from_str(text) {
    Ok(u) => u,
    Err(e) => {
      let resp = WsResponse {
        id: String::new(),
        ok: false,
        data: None,
        error: Some(WsError {
          code: "VALIDATION_ERROR".into(),
          message: format!("Invalid uplink message: {e}"),
          transient: false,
        }),
      };
      let _ = ws_sender
        .send(Message::Text(serde_json::to_string(&resp).unwrap_or_default().into()))
        .await;
      return;
    }
  };

  // Validate procedure belongs to this channel
  let expected_prefix = format!("{channel_name}.");
  if !uplink.procedure.starts_with(&expected_prefix) || uplink.procedure.ends_with(".events") {
    let msg = if uplink.procedure.ends_with(".events") {
      "Cannot invoke .events subscription over uplink".to_string()
    } else {
      format!("Procedure '{}' does not belong to channel '{channel_name}'", uplink.procedure)
    };
    let resp = WsResponse {
      id: uplink.id,
      ok: false,
      data: None,
      error: Some(WsError { code: "FORBIDDEN".into(), message: msg, transient: false }),
    };
    let _ =
      ws_sender.send(Message::Text(serde_json::to_string(&resp).unwrap_or_default().into())).await;
    return;
  }

  // Merge channel input with uplink input
  let uplink_input = uplink.input.unwrap_or(serde_json::Value::Object(serde_json::Map::new()));
  let merged_input = merge_json_objects(channel_input, &uplink_input);

  // Resolve handler name (hash map lookup)
  let proc_name = &uplink.procedure;
  let resolved_proc = if let Some(ref map) = state.rpc_hash_map {
    map.get(proc_name).cloned().unwrap_or_else(|| proc_name.clone())
  } else {
    proc_name.clone()
  };

  let resp = match state.handlers.get(&resolved_proc) {
    Some(proc) => match (proc.handler)(merged_input).await {
      Ok(data) => WsResponse { id: uplink.id, ok: true, data: Some(data), error: None },
      Err(e) => WsResponse {
        id: uplink.id,
        ok: false,
        data: None,
        error: Some(WsError {
          code: e.code().to_string(),
          message: e.message().to_string(),
          transient: false,
        }),
      },
    },
    None => WsResponse {
      id: uplink.id,
      ok: false,
      data: None,
      error: Some(WsError {
        code: "NOT_FOUND".into(),
        message: format!("Procedure '{resolved_proc}' not found"),
        transient: false,
      }),
    },
  };

  let _ =
    ws_sender.send(Message::Text(serde_json::to_string(&resp).unwrap_or_default().into())).await;
}

pub(super) async fn handle_channel_ws(
  state: Arc<AppState>,
  sub_name: String,
  channel_input: serde_json::Value,
  socket: WebSocket,
) {
  let channel_name = sub_name.strip_suffix(".events").unwrap_or(&sub_name);

  let (mut ws_sender, mut ws_receiver) = {
    use futures_util::StreamExt as _;
    socket.split()
  };

  // Start the subscription stream for this channel
  let sub = match state.subscriptions.get(&sub_name) {
    Some(s) => s.clone(),
    None => {
      let err_msg = serde_json::json!({
        "error": { "code": "NOT_FOUND", "message": format!("Channel '{channel_name}' not found"), "transient": false }
      });
      let _ = ws_sender.send(Message::Text(err_msg.to_string().into())).await;
      let _ = ws_sender.close().await;
      return;
    }
  };

  let event_stream = match (sub.handler)(channel_input.clone()).await {
    Ok(stream) => stream,
    Err(e) => {
      let err_msg = serde_json::json!({
        "error": { "code": e.code(), "message": e.message(), "transient": false }
      });
      let _ = ws_sender.send(Message::Text(err_msg.to_string().into())).await;
      let _ = ws_sender.close().await;
      return;
    }
  };

  let mut event_stream = std::pin::pin!(event_stream);
  let mut heartbeat = interval(Duration::from_secs(30));

  loop {
    tokio::select! {
      msg = StreamExt::next(&mut ws_receiver) => {
        match msg {
          Some(Ok(Message::Text(text))) => {
            dispatch_ws_uplink(&state, channel_name, &channel_input, &text, &mut ws_sender).await;
          }
          Some(Ok(Message::Close(_))) | None => break,
          _ => continue,
        }
      }
      event = event_stream.next() => {
        match event {
          Some(Ok(value)) => {
            let event_name = value.get("type").and_then(serde_json::Value::as_str).unwrap_or("unknown");
            let payload = value.get("payload").cloned().unwrap_or(serde_json::Value::Null);
            let msg = serde_json::json!({ "event": event_name, "payload": payload });
            if ws_sender.send(Message::Text(msg.to_string().into())).await.is_err() {
              break;
            }
          }
          Some(Err(e)) => {
            let err: &SeamError = &e;
            let msg = serde_json::json!({
              "error": { "code": err.code(), "message": err.message(), "transient": false }
            });
            let _ = ws_sender.send(Message::Text(msg.to_string().into())).await;
            break;
          }
          None => break,
        }
      }
      _ = heartbeat.tick() => {
        let msg = serde_json::json!({ "heartbeat": true });
        if ws_sender.send(Message::Text(msg.to_string().into())).await.is_err() {
          break;
        }
      }
    }
  }

  let _ = ws_sender.close().await;
}
