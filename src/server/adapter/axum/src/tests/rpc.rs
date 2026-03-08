/* src/server/adapter/axum/src/tests/rpc.rs */

use super::*;

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
	use seam_server::SeamError;
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

fn validation_router(mode: seam_server::ValidationMode) -> axum::Router {
	let server = SeamServer::new().validation_mode(mode).procedure(ProcedureDef {
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
	server.into_axum_router()
}

#[tokio::test]
async fn validation_rejects_invalid_input() {
	let router = validation_router(seam_server::ValidationMode::Always);
	let (status, json) =
		send_request(router, "POST", "/_seam/procedure/greet", Some(r#"{"name": 42}"#)).await;
	assert_eq!(status, StatusCode::BAD_REQUEST);
	assert_eq!(json["ok"], false);
	assert_eq!(json["error"]["code"], "VALIDATION_ERROR");
	assert!(json["error"]["message"].as_str().unwrap().contains("Input validation failed"));
	let details = json["error"]["details"].as_array().expect("details must be array");
	assert!(!details.is_empty());
	assert_eq!(details[0]["path"], "/name");
	assert_eq!(details[0]["expected"], "string");
}

#[tokio::test]
async fn validation_accepts_valid_input() {
	let router = validation_router(seam_server::ValidationMode::Always);
	let (status, json) =
		send_request(router, "POST", "/_seam/procedure/greet", Some(r#"{"name": "Seam"}"#)).await;
	assert_eq!(status, StatusCode::OK);
	assert_eq!(json["ok"], true);
	assert_eq!(json["data"]["message"], "Hello, Seam!");
}

#[tokio::test]
async fn validation_batch_one_invalid() {
	let router = validation_router(seam_server::ValidationMode::Always);
	let body = r#"{"calls":[{"procedure":"greet","input":{"name":42}},{"procedure":"greet","input":{"name":"OK"}}]}"#;
	let (status, json) = send_request(router, "POST", "/_seam/procedure/_batch", Some(body)).await;
	assert_eq!(status, StatusCode::OK);
	let results = json["data"]["results"].as_array().unwrap();
	assert_eq!(results.len(), 2);
	// First call should fail validation
	assert_eq!(results[0]["ok"], false);
	assert_eq!(results[0]["error"]["code"], "VALIDATION_ERROR");
	assert!(results[0]["error"]["details"].as_array().is_some());
	// Second call should succeed
	assert_eq!(results[1]["ok"], true);
}

#[tokio::test]
async fn validation_never_skips() {
	let router = validation_router(seam_server::ValidationMode::Never);
	// Invalid input passes through when validation is disabled
	let (status, json) =
		send_request(router, "POST", "/_seam/procedure/greet", Some(r#"{"name": 42}"#)).await;
	assert_eq!(status, StatusCode::OK);
	assert_eq!(json["ok"], true);
}

#[tokio::test]
async fn validation_error_details_shape() {
	let router = validation_router(seam_server::ValidationMode::Always);
	let (_, json) =
		send_request(router, "POST", "/_seam/procedure/greet", Some(r#"{"name": 42}"#)).await;
	// Verify exact shape matches three-端 format
	assert_eq!(json["ok"], false);
	let error = &json["error"];
	assert_eq!(error["code"], "VALIDATION_ERROR");
	assert_eq!(error["transient"], false);
	let details = error["details"].as_array().unwrap();
	let detail = &details[0];
	assert!(detail.get("path").is_some());
	assert!(detail.get("expected").is_some());
	assert!(detail.get("actual").is_some());
}
