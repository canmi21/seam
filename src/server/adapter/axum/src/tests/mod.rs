/* src/server/adapter/axum/src/tests/mod.rs */

mod rpc;
mod stream;
mod upload;

use super::*;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use seam_server::procedure::{ProcedureDef, ProcedureType};
use tower::ServiceExt;

fn test_router() -> axum::Router {
	let mut server = SeamServer::new();
	server = server.procedure(ProcedureDef {
		name: "greet".into(),
		proc_type: ProcedureType::Query,
		input_schema: serde_json::json!({"properties": {"name": {"type": "string"}}}),
		output_schema: serde_json::json!({"properties": {"message": {"type": "string"}}}),
		error_schema: None,
		context_keys: vec![],
		handler: Arc::new(|input, _ctx| {
			Box::pin(async move {
				let name = input.get("name").and_then(|v| v.as_str()).unwrap_or("World");
				Ok(serde_json::json!({"message": format!("Hello, {}!", name)}))
			})
		}),
	});
	server = server.procedure(ProcedureDef {
		name: "updateName".into(),
		proc_type: ProcedureType::Command,
		input_schema: serde_json::json!({"properties": {"name": {"type": "string"}}}),
		output_schema: serde_json::json!({"properties": {"ok": {"type": "boolean"}}}),
		error_schema: None,
		context_keys: vec![],
		handler: Arc::new(|_input, _ctx| Box::pin(async move { Ok(serde_json::json!({"ok": true})) })),
	});
	server.into_axum_router()
}

async fn send_request(
	router: axum::Router,
	method: &str,
	path: &str,
	body: Option<&str>,
) -> (StatusCode, serde_json::Value) {
	let body_content = body.map(|b| Body::from(b.to_string())).unwrap_or(Body::empty());
	let req = Request::builder()
		.method(method)
		.uri(path)
		.header("content-type", "application/json")
		.body(body_content)
		.unwrap();
	let resp = router.oneshot(req).await.unwrap();
	let status = resp.status();
	let bytes = resp.into_body().collect().await.unwrap().to_bytes();
	let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap_or(serde_json::json!(null));
	(status, json)
}

async fn send_raw_request(router: axum::Router, req: Request<Body>) -> (StatusCode, String) {
	let resp = router.oneshot(req).await.unwrap();
	let status = resp.status();
	let bytes = resp.into_body().collect().await.unwrap().to_bytes();
	(status, String::from_utf8_lossy(&bytes).to_string())
}
