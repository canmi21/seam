/* src/server/adapter/axum/src/tests/stream.rs */

use super::*;
use seam_server::SeamError;
use seam_server::procedure::{BoxStream, StreamDef};

fn stream_router() -> axum::Router {
	let server = SeamServer::new().stream(StreamDef {
		name: "countStream".into(),
		input_schema: serde_json::json!({"properties": {"n": {"type": "int32"}}}),
		chunk_output_schema: serde_json::json!({"properties": {"value": {"type": "int32"}}}),
		error_schema: None,
		context_keys: vec![],
		suppress: None,
		handler: Arc::new(|params| {
			Box::pin(async move {
				let n = params.input.get("n").and_then(serde_json::Value::as_i64).unwrap_or(3) as usize;
				let stream: BoxStream<Result<serde_json::Value, SeamError>> =
					Box::pin(futures_util::stream::iter((0..n).map(|i| Ok(serde_json::json!({"value": i})))));
				Ok(stream)
			})
		}),
	});
	server.into_axum_router()
}

fn heartbeat_stream_router(interval: std::time::Duration) -> axum::Router {
	let server = SeamServer::new()
		.transport_config(seam_server::TransportConfig {
			heartbeat_interval: interval,
			sse_idle_timeout: std::time::Duration::from_secs(12),
			pong_timeout: std::time::Duration::from_secs(5),
		})
		.stream(StreamDef {
			name: "countStream".into(),
			input_schema: serde_json::json!({"properties": {"n": {"type": "int32"}}}),
			chunk_output_schema: serde_json::json!({"properties": {"value": {"type": "int32"}}}),
			error_schema: None,
			context_keys: vec![],
			suppress: None,
			handler: Arc::new(|_params| {
				Box::pin(async move {
					let (tx, rx) = tokio::sync::mpsc::channel(8);
					tokio::spawn(async move {
						tokio::time::sleep(std::time::Duration::from_millis(250)).await;
						let _ = tx.send(Ok(serde_json::json!({"value": 1}))).await;
					});
					let stream: BoxStream<Result<serde_json::Value, SeamError>> =
						Box::pin(tokio_stream::wrappers::ReceiverStream::new(rx));
					Ok(stream)
				})
			}),
		});
	server.into_axum_router()
}

#[tokio::test]
async fn stream_returns_sse_with_ids() {
	let router = stream_router();
	let req = Request::builder()
		.method("POST")
		.uri("/_seam/procedure/countStream")
		.header("content-type", "application/json")
		.body(Body::from(r#"{"n": 3}"#))
		.unwrap();
	let (status, body) = send_raw_request(router, req).await;
	assert_eq!(status, StatusCode::OK);
	// Verify SSE data events have incrementing ids
	assert!(body.contains("event: data\nid: 0\n"), "missing id: 0 in:\n{body}");
	assert!(body.contains("event: data\nid: 1\n"), "missing id: 1 in:\n{body}");
	assert!(body.contains("event: data\nid: 2\n"), "missing id: 2 in:\n{body}");
	assert!(body.contains("event: complete\n"), "missing complete event");
}

#[tokio::test]
async fn stream_starts_with_heartbeat() {
	let router = heartbeat_stream_router(std::time::Duration::from_millis(100));
	let req = Request::builder()
		.method("POST")
		.uri("/_seam/procedure/countStream")
		.header("content-type", "application/json")
		.body(Body::from(r#"{"n": 1}"#))
		.unwrap();
	let (status, body) = send_raw_request(router, req).await;
	assert_eq!(status, StatusCode::OK);
	assert!(body.starts_with(": heartbeat\n\n"), "missing initial heartbeat in:\n{body}");
	assert!(body.contains("event: data\nid: 0\n"), "missing first data event in:\n{body}");
}

#[tokio::test]
async fn stream_complete_event() {
	let router = stream_router();
	let req = Request::builder()
		.method("POST")
		.uri("/_seam/procedure/countStream")
		.header("content-type", "application/json")
		.body(Body::from(r#"{"n": 0}"#))
		.unwrap();
	let (status, body) = send_raw_request(router, req).await;
	assert_eq!(status, StatusCode::OK);
	// Empty stream should just have complete event
	assert!(body.contains("event: complete\n"));
	assert!(!body.contains("event: data\n"));
}

#[tokio::test]
async fn stream_validation_error() {
	let server =
		SeamServer::new().validation_mode(seam_server::ValidationMode::Always).stream(StreamDef {
			name: "typedStream".into(),
			input_schema: serde_json::json!({"properties": {"n": {"type": "int32"}}}),
			chunk_output_schema: serde_json::json!({}),
			error_schema: None,
			context_keys: vec![],
			suppress: None,
			handler: Arc::new(|_params| {
				Box::pin(async move {
					let stream: BoxStream<Result<serde_json::Value, SeamError>> =
						Box::pin(futures_util::stream::empty());
					Ok(stream)
				})
			}),
		});
	let router = server.into_axum_router();
	let req = Request::builder()
		.method("POST")
		.uri("/_seam/procedure/typedStream")
		.header("content-type", "application/json")
		.body(Body::from(r#"{"n": "not a number"}"#))
		.unwrap();
	let (status, body) = send_raw_request(router, req).await;
	assert_eq!(status, StatusCode::OK); // SSE always returns 200, error is in the stream
	assert!(body.contains("event: error\n"));
	assert!(body.contains("VALIDATION_ERROR"));
}

#[tokio::test]
async fn manifest_stream_chunk_output() {
	let router = stream_router();
	let (status, json) = send_request(router, "GET", "/_seam/manifest.json", None).await;
	assert_eq!(status, StatusCode::OK);
	let stream_entry = &json["procedures"]["countStream"];
	assert_eq!(stream_entry["kind"], "stream");
	assert!(stream_entry["chunkOutput"].is_object());
	assert!(stream_entry.get("output").is_none());
}
