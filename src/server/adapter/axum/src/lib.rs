/* src/server/adapter/axum/src/lib.rs */
#![cfg_attr(test, allow(clippy::unwrap_used))]

mod error;
mod handler;

use std::sync::Arc;

use seam_server::SeamServer;
use seam_server::manifest::build_manifest;

/// Re-export seam-server core for convenience
pub use seam_server;

/// Extension trait that converts a `SeamServer` into an Axum router.
pub trait IntoAxumRouter {
	fn into_axum_router(self) -> axum::Router;
	fn serve(
		self,
		addr: &str,
	) -> impl std::future::Future<Output = Result<(), Box<dyn std::error::Error>>> + Send;
}

impl IntoAxumRouter for SeamServer {
	fn into_axum_router(self) -> axum::Router {
		let parts = self.into_parts();
		let manifest_json = serde_json::to_value(build_manifest(
			&parts.procedures,
			&parts.subscriptions,
			parts.channel_metas,
			&parts.context_config,
		))
		.expect("manifest serialization");
		let handlers = parts.procedures.into_iter().map(|p| (p.name.clone(), Arc::new(p))).collect();
		let subscriptions =
			parts.subscriptions.into_iter().map(|s| (s.name.clone(), Arc::new(s))).collect();
		handler::build_router(
			manifest_json,
			handlers,
			subscriptions,
			parts.pages,
			parts.rpc_hash_map,
			parts.i18n_config,
			parts.strategies,
			parts.context_config,
			&parts.validation_mode,
		)
	}

	#[allow(clippy::print_stdout)]
	async fn serve(self, addr: &str) -> Result<(), Box<dyn std::error::Error>> {
		let router = self.into_axum_router();
		let listener = tokio::net::TcpListener::bind(addr).await?;
		let local_addr = listener.local_addr()?;
		println!("Seam Rust backend running on http://localhost:{}", local_addr.port());
		axum::serve(listener, router).await?;
		Ok(())
	}
}

#[cfg(test)]
mod tests {
	use super::*;
	use axum::body::Body;
	use axum::http::{Request, StatusCode};
	use http_body_util::BodyExt;
	use seam_server::SeamError;
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
			handler: Arc::new(|_input, _ctx| {
				Box::pin(async move { Ok(serde_json::json!({"ok": true})) })
			}),
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

	#[test]
	fn into_axum_router_builds_without_panic() {
		let server = SeamServer::new();
		let _router = server.into_axum_router();
	}

	#[tokio::test]
	async fn manifest_returns_procedures() {
		let router = test_router();
		let (status, json) = send_request(router, "GET", "/_seam/manifest.json", None).await;
		assert_eq!(status, StatusCode::OK);
		assert!(json.get("procedures").is_some(), "manifest must contain 'procedures' key");
	}

	#[tokio::test]
	async fn rpc_valid_call() {
		let router = test_router();
		let (status, json) =
			send_request(router, "POST", "/_seam/procedure/greet", Some(r#"{"name":"Seam"}"#)).await;
		assert_eq!(status, StatusCode::OK);
		assert_eq!(json["ok"], true);
		assert_eq!(json["data"]["message"], "Hello, Seam!");
	}

	#[tokio::test]
	async fn rpc_invalid_json() {
		let router = test_router();
		let (status, json) =
			send_request(router, "POST", "/_seam/procedure/greet", Some("not json")).await;
		assert_eq!(status, StatusCode::BAD_REQUEST);
		assert_eq!(json["error"]["code"], "VALIDATION_ERROR");
	}

	#[tokio::test]
	async fn rpc_not_found() {
		let router = test_router();
		let (status, json) = send_request(router, "POST", "/_seam/procedure/unknown", Some("{}")).await;
		assert_eq!(status, StatusCode::NOT_FOUND);
		assert_eq!(json["error"]["code"], "NOT_FOUND");
	}

	#[tokio::test]
	async fn rpc_command_type() {
		let router = test_router();
		let (status, json) =
			send_request(router, "POST", "/_seam/procedure/updateName", Some(r#"{"name":"test"}"#)).await;
		assert_eq!(status, StatusCode::OK);
		assert_eq!(json["ok"], true);
		assert_eq!(json["data"]["ok"], true);
	}

	#[tokio::test]
	async fn batch_rpc_mixed() {
		let router = test_router();
		let body = r#"{"calls":[{"procedure":"greet","input":{"name":"A"}},{"procedure":"updateName","input":{"name":"B"}}]}"#;
		let (status, json) = send_request(router, "POST", "/_seam/procedure/_batch", Some(body)).await;
		assert_eq!(status, StatusCode::OK);
		let results = json["data"]["results"].as_array().expect("results must be an array");
		assert_eq!(results.len(), 2);
		assert_eq!(results[0]["data"]["message"], "Hello, A!");
		assert_eq!(results[1]["data"]["ok"], true);
	}

	#[tokio::test]
	async fn batch_invalid_body() {
		let router = test_router();
		let (status, _json) =
			send_request(router, "POST", "/_seam/procedure/_batch", Some("not json")).await;
		assert_eq!(status, StatusCode::BAD_REQUEST);
	}

	#[test]
	fn error_status_mapping() {
		use axum::response::IntoResponse;
		let cases = vec![
			(SeamError::validation("x"), StatusCode::BAD_REQUEST),
			(SeamError::not_found("x"), StatusCode::NOT_FOUND),
			(SeamError::internal("x"), StatusCode::INTERNAL_SERVER_ERROR),
			(SeamError::unauthorized("x"), StatusCode::UNAUTHORIZED),
			(SeamError::forbidden("x"), StatusCode::FORBIDDEN),
			(SeamError::rate_limited("x"), StatusCode::TOO_MANY_REQUESTS),
		];
		for (err, expected) in cases {
			let resp = crate::error::AxumError(err).into_response();
			assert_eq!(resp.status(), expected);
		}
	}
}
