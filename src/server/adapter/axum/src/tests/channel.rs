/* src/server/adapter/axum/src/tests/channel.rs */

use super::*;
use seam_server::procedure::{BoxStream, ProcedureDef, ProcedureType, SubscriptionDef};
use seam_server::{SeamError, TransportConfig};
use std::time::Duration;
use tokio::net::TcpListener;

/// Router for SSE and event-receive tests: fast-finishing subscription stream
fn channel_router() -> axum::Router {
	let server = SeamServer::new()
		.subscription(SubscriptionDef {
			name: "chat.events".into(),
			input_schema: serde_json::json!({}),
			output_schema: serde_json::json!({}),
			error_schema: None,
			context_keys: vec![],
			suppress: None,
			handler: Arc::new(|_params| {
				Box::pin(async move {
					let stream: BoxStream<Result<serde_json::Value, SeamError>> =
						Box::pin(futures_util::stream::iter(vec![
							Ok(serde_json::json!({"type": "message", "payload": {"text": "hello"}})),
							Ok(serde_json::json!({"type": "message", "payload": {"text": "world"}})),
						]));
					Ok(stream)
				})
			}),
		})
		.procedure(ProcedureDef {
			name: "chat.send".into(),
			proc_type: ProcedureType::Command,
			input_schema: serde_json::json!({"properties": {"text": {"type": "string"}}}),
			output_schema: serde_json::json!({"properties": {"ok": {"type": "boolean"}}}),
			error_schema: None,
			context_keys: vec![],
			suppress: None,
			cache: None,
			handler: Arc::new(|_input, _ctx| {
				Box::pin(async move { Ok(serde_json::json!({"ok": true})) })
			}),
		});
	server.into_axum_router()
}

/// Router for uplink tests: long-lived subscription stream that stays open
/// while the test sends commands and reads responses
fn uplink_router() -> axum::Router {
	let server = SeamServer::new()
		.subscription(SubscriptionDef {
			name: "chat.events".into(),
			input_schema: serde_json::json!({}),
			output_schema: serde_json::json!({}),
			error_schema: None,
			context_keys: vec![],
			suppress: None,
			handler: Arc::new(|_params| {
				Box::pin(async move {
					// Keep the stream alive long enough for uplink tests
					let (tx, rx) = tokio::sync::mpsc::channel(8);
					tokio::spawn(async move {
						tokio::time::sleep(Duration::from_secs(10)).await;
						drop(tx);
					});
					let stream: BoxStream<Result<serde_json::Value, SeamError>> =
						Box::pin(tokio_stream::wrappers::ReceiverStream::new(rx));
					Ok(stream)
				})
			}),
		})
		.procedure(ProcedureDef {
			name: "chat.send".into(),
			proc_type: ProcedureType::Command,
			input_schema: serde_json::json!({"properties": {"text": {"type": "string"}}}),
			output_schema: serde_json::json!({"properties": {"ok": {"type": "boolean"}}}),
			error_schema: None,
			context_keys: vec![],
			suppress: None,
			cache: None,
			handler: Arc::new(|_input, _ctx| {
				Box::pin(async move { Ok(serde_json::json!({"ok": true})) })
			}),
		});
	server.into_axum_router()
}

fn heartbeat_router(interval: Duration) -> axum::Router {
	let server = SeamServer::new()
		.transport_config(TransportConfig {
			heartbeat_interval: interval,
			sse_idle_timeout: Duration::from_secs(12),
			pong_timeout: Duration::from_secs(5),
		})
		.subscription(SubscriptionDef {
			name: "chat.events".into(),
			input_schema: serde_json::json!({}),
			output_schema: serde_json::json!({}),
			error_schema: None,
			context_keys: vec![],
			suppress: None,
			handler: Arc::new(|_params| {
				Box::pin(async move {
					// Keep the stream alive so heartbeat has time to fire
					let (tx, rx) = tokio::sync::mpsc::channel(8);
					tokio::spawn(async move {
						tokio::time::sleep(Duration::from_millis(500)).await;
						let _ =
							tx.send(Ok(serde_json::json!({"type": "done", "payload": {"text": "fin"}}))).await;
					});
					let stream: BoxStream<Result<serde_json::Value, SeamError>> =
						Box::pin(tokio_stream::wrappers::ReceiverStream::new(rx));
					Ok(stream)
				})
			}),
		});
	server.into_axum_router()
}

async fn spawn_server(router: axum::Router) -> (u16, tokio::task::JoinHandle<()>) {
	let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
	let port = listener.local_addr().unwrap().port();
	let handle = tokio::spawn(async move {
		axum::serve(listener, router).await.unwrap();
	});
	(port, handle)
}

// --- SSE subscription tests ---

#[tokio::test]
async fn sse_subscription_receives_events() {
	let router = channel_router();
	let req = Request::builder()
		.method("GET")
		.uri("/_seam/procedure/chat.events")
		.body(Body::empty())
		.unwrap();
	let (status, body) = send_raw_request(router, req).await;
	assert_eq!(status, StatusCode::OK);
	assert!(body.contains("event: data\n"), "missing data event in:\n{body}");
	assert!(body.contains(r#""text":"hello""#), "missing hello payload in:\n{body}");
	assert!(body.contains(r#""text":"world""#), "missing world payload in:\n{body}");
}

#[tokio::test]
async fn sse_subscription_unknown_returns_error() {
	let router = channel_router();
	let req = Request::builder()
		.method("GET")
		.uri("/_seam/procedure/nope.events")
		.body(Body::empty())
		.unwrap();
	let (status, body) = send_raw_request(router, req).await;
	assert_eq!(status, StatusCode::OK); // SSE always returns 200, error is in the stream
	assert!(body.contains("event: error\n"), "missing error event in:\n{body}");
	assert!(body.contains("NOT_FOUND"), "missing NOT_FOUND code in:\n{body}");
}

#[tokio::test]
async fn sse_subscription_sends_complete() {
	let router = channel_router();
	let req = Request::builder()
		.method("GET")
		.uri("/_seam/procedure/chat.events")
		.body(Body::empty())
		.unwrap();
	let (status, body) = send_raw_request(router, req).await;
	assert_eq!(status, StatusCode::OK);
	assert!(body.contains("event: complete\n"), "missing complete event in:\n{body}");
}

#[tokio::test]
async fn sse_subscription_starts_with_heartbeat() {
	let router = heartbeat_router(Duration::from_millis(100));
	let req = Request::builder()
		.method("GET")
		.uri("/_seam/procedure/chat.events")
		.body(Body::empty())
		.unwrap();
	let (status, body) = send_raw_request(router, req).await;
	assert_eq!(status, StatusCode::OK);
	assert!(body.starts_with(": heartbeat\n\n"), "missing initial heartbeat in:\n{body}");
}

// --- WebSocket channel tests ---

#[tokio::test]
async fn ws_channel_receives_events() {
	let router = channel_router();
	let (port, handle) = spawn_server(router).await;
	let url = format!("ws://127.0.0.1:{port}/_seam/procedure/chat.events");
	let (mut ws, _) = tokio_tungstenite::connect_async(&url).await.unwrap();

	use futures_util::StreamExt;
	let mut events = Vec::new();
	while let Some(msg) = ws.next().await {
		let msg = msg.unwrap();
		if let tokio_tungstenite::tungstenite::Message::Text(text) = msg {
			let v: serde_json::Value = serde_json::from_str(&text).unwrap();
			if v.get("event").is_some() {
				events.push(v);
			}
			if events.len() == 2 {
				break;
			}
		}
	}

	assert_eq!(events.len(), 2);
	assert_eq!(events[0]["event"], "message");
	assert_eq!(events[0]["payload"]["text"], "hello");
	assert_eq!(events[1]["event"], "message");
	assert_eq!(events[1]["payload"]["text"], "world");

	handle.abort();
}

#[tokio::test]
async fn ws_channel_uplink_command() {
	let router = uplink_router();
	let (port, handle) = spawn_server(router).await;
	let url = format!("ws://127.0.0.1:{port}/_seam/procedure/chat.events");
	let (mut ws, _) = tokio_tungstenite::connect_async(&url).await.unwrap();

	use futures_util::{SinkExt, StreamExt};

	let uplink = serde_json::json!({
		"id": "1",
		"procedure": "chat.send",
		"input": {"text": "hi"}
	});
	ws.send(tokio_tungstenite::tungstenite::Message::Text(uplink.to_string().into())).await.unwrap();

	// Read messages until we find the response with id "1"
	let timeout = tokio::time::sleep(Duration::from_secs(5));
	tokio::pin!(timeout);
	let mut response: Option<serde_json::Value> = None;
	loop {
		tokio::select! {
			msg = ws.next() => {
				match msg {
					Some(Ok(tokio_tungstenite::tungstenite::Message::Text(text))) => {
						let v: serde_json::Value = serde_json::from_str(&text).unwrap();
						if v.get("id").and_then(|v| v.as_str()) == Some("1") {
							response = Some(v);
							break;
						}
					}
					Some(Ok(_)) => continue,
					_ => break,
				}
			}
			_ = &mut timeout => break,
		}
	}

	let resp = response.expect("should receive response with id=1");
	assert_eq!(resp["ok"], true);
	assert_eq!(resp["data"]["ok"], true);

	handle.abort();
}

#[tokio::test]
async fn ws_channel_uplink_wrong_scope() {
	let router = uplink_router();
	let (port, handle) = spawn_server(router).await;
	let url = format!("ws://127.0.0.1:{port}/_seam/procedure/chat.events");
	let (mut ws, _) = tokio_tungstenite::connect_async(&url).await.unwrap();

	use futures_util::{SinkExt, StreamExt};

	let uplink = serde_json::json!({
		"id": "1",
		"procedure": "other.cmd",
		"input": {}
	});
	ws.send(tokio_tungstenite::tungstenite::Message::Text(uplink.to_string().into())).await.unwrap();

	let timeout = tokio::time::sleep(Duration::from_secs(5));
	tokio::pin!(timeout);
	let mut response: Option<serde_json::Value> = None;
	loop {
		tokio::select! {
			msg = ws.next() => {
				match msg {
					Some(Ok(tokio_tungstenite::tungstenite::Message::Text(text))) => {
						let v: serde_json::Value = serde_json::from_str(&text).unwrap();
						if v.get("id").and_then(|v| v.as_str()) == Some("1") {
							response = Some(v);
							break;
						}
					}
					Some(Ok(_)) => continue,
					_ => break,
				}
			}
			_ = &mut timeout => break,
		}
	}

	let resp = response.expect("should receive error response with id=1");
	assert_eq!(resp["ok"], false);
	assert_eq!(resp["error"]["code"], "FORBIDDEN");

	handle.abort();
}

#[tokio::test]
async fn ws_channel_invalid_uplink_json() {
	let router = uplink_router();
	let (port, handle) = spawn_server(router).await;
	let url = format!("ws://127.0.0.1:{port}/_seam/procedure/chat.events");
	let (mut ws, _) = tokio_tungstenite::connect_async(&url).await.unwrap();

	use futures_util::{SinkExt, StreamExt};

	ws.send(tokio_tungstenite::tungstenite::Message::Text("not json".into())).await.unwrap();

	let timeout = tokio::time::sleep(Duration::from_secs(5));
	tokio::pin!(timeout);
	let mut response: Option<serde_json::Value> = None;
	loop {
		tokio::select! {
			msg = ws.next() => {
				match msg {
					Some(Ok(tokio_tungstenite::tungstenite::Message::Text(text))) => {
						let v: serde_json::Value = serde_json::from_str(&text).unwrap();
						// Parse error response has empty id and error field
						if v.get("error").is_some() && v.get("id").is_some() {
							response = Some(v);
							break;
						}
					}
					Some(Ok(_)) => continue,
					_ => break,
				}
			}
			_ = &mut timeout => break,
		}
	}

	let resp = response.expect("should receive error response for invalid JSON");
	assert_eq!(resp["ok"], false);
	assert_eq!(resp["error"]["code"], "VALIDATION_ERROR");

	handle.abort();
}

#[tokio::test]
async fn ws_channel_heartbeat() {
	let router = heartbeat_router(Duration::from_millis(100));
	let (port, handle) = spawn_server(router).await;
	let url = format!("ws://127.0.0.1:{port}/_seam/procedure/chat.events");
	let (mut ws, _) = tokio_tungstenite::connect_async(&url).await.unwrap();

	use futures_util::StreamExt;

	let mut got_heartbeat = false;
	let timeout = tokio::time::sleep(Duration::from_secs(3));
	tokio::pin!(timeout);

	loop {
		tokio::select! {
			msg = ws.next() => {
				match msg {
					Some(Ok(tokio_tungstenite::tungstenite::Message::Text(text))) => {
						let v: serde_json::Value = serde_json::from_str(&text).unwrap();
						if v.get("heartbeat") == Some(&serde_json::json!(true)) {
							got_heartbeat = true;
							break;
						}
					}
					Some(Ok(_)) => continue,
					_ => break,
				}
			}
			_ = &mut timeout => {
				break;
			}
		}
	}

	assert!(got_heartbeat, "should receive heartbeat message");

	handle.abort();
}

#[tokio::test]
async fn ws_channel_unknown_subscription() {
	let router = channel_router();
	let (port, handle) = spawn_server(router).await;
	let url = format!("ws://127.0.0.1:{port}/_seam/procedure/unknown.events");
	let (mut ws, _) = tokio_tungstenite::connect_async(&url).await.unwrap();

	use futures_util::StreamExt;

	let mut got_error = false;
	while let Some(msg) = ws.next().await {
		let msg = msg.unwrap();
		if let tokio_tungstenite::tungstenite::Message::Text(text) = msg {
			let v: serde_json::Value = serde_json::from_str(&text).unwrap();
			if let Some(err) = v.get("error") {
				assert_eq!(err["code"], "NOT_FOUND");
				got_error = true;
				break;
			}
		}
	}

	assert!(got_error, "should receive NOT_FOUND error for unknown subscription");

	// Connection should close after the error
	let next = ws.next().await;
	assert!(
		next.is_none() || matches!(next, Some(Ok(tokio_tungstenite::tungstenite::Message::Close(_)))),
		"connection should close after NOT_FOUND error"
	);

	handle.abort();
}
