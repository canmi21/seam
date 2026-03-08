/* src/server/adapter/axum/src/tests/upload.rs */

use super::*;
use seam_server::procedure::UploadDef;

fn upload_router() -> axum::Router {
	let server = SeamServer::new().upload(UploadDef {
		name: "echoUpload".into(),
		input_schema: serde_json::json!({}),
		output_schema: serde_json::json!({"properties": {"size": {"type": "int32"}, "filename": {"type": "string"}}}),
		error_schema: None,
		context_keys: vec![],
		handler: Arc::new(|_input, file, _ctx| {
			Box::pin(async move {
				Ok(serde_json::json!({
					"size": file.data.len(),
					"filename": file.name.unwrap_or_default()
				}))
			})
		}),
	});
	server.into_axum_router()
}

fn build_multipart_body(metadata: &str, file_content: &[u8], filename: &str) -> (String, Vec<u8>) {
	let boundary = "----SeamTestBoundary";
	let mut body = Vec::new();

	// metadata field
	body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
	body.extend_from_slice(b"Content-Disposition: form-data; name=\"metadata\"\r\n\r\n");
	body.extend_from_slice(metadata.as_bytes());
	body.extend_from_slice(b"\r\n");

	// file field
	body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
	body.extend_from_slice(
		format!("Content-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n")
			.as_bytes(),
	);
	body.extend_from_slice(b"Content-Type: application/octet-stream\r\n\r\n");
	body.extend_from_slice(file_content);
	body.extend_from_slice(b"\r\n");

	// final boundary
	body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());

	let content_type = format!("multipart/form-data; boundary={boundary}");
	(content_type, body)
}

#[tokio::test]
async fn upload_returns_json() {
	let router = upload_router();
	let (content_type, body) = build_multipart_body("{}", b"hello world", "test.txt");
	let req = Request::builder()
		.method("POST")
		.uri("/_seam/procedure/echoUpload")
		.header("content-type", content_type)
		.body(Body::from(body))
		.unwrap();
	let resp = router.oneshot(req).await.unwrap();
	let status = resp.status();
	let bytes = resp.into_body().collect().await.unwrap().to_bytes();
	let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
	assert_eq!(status, StatusCode::OK);
	assert_eq!(json["ok"], true);
	assert_eq!(json["data"]["size"], 11);
	assert_eq!(json["data"]["filename"], "test.txt");
}

#[tokio::test]
async fn upload_missing_file_400() {
	let router = upload_router();
	// Send multipart with only metadata, no file
	let boundary = "----SeamTestBoundary";
	let mut body = Vec::new();
	body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
	body.extend_from_slice(b"Content-Disposition: form-data; name=\"metadata\"\r\n\r\n{}\r\n");
	body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());

	let req = Request::builder()
		.method("POST")
		.uri("/_seam/procedure/echoUpload")
		.header("content-type", format!("multipart/form-data; boundary={boundary}"))
		.body(Body::from(body))
		.unwrap();
	let resp = router.oneshot(req).await.unwrap();
	let status = resp.status();
	let bytes = resp.into_body().collect().await.unwrap().to_bytes();
	let json: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
	assert_eq!(status, StatusCode::BAD_REQUEST);
	assert_eq!(json["error"]["code"], "VALIDATION_ERROR");
}

#[tokio::test]
async fn manifest_upload_output() {
	let router = upload_router();
	let (status, json) = send_request(router, "GET", "/_seam/manifest.json", None).await;
	assert_eq!(status, StatusCode::OK);
	let upload_entry = &json["procedures"]["echoUpload"];
	assert_eq!(upload_entry["kind"], "upload");
	assert!(upload_entry["output"].is_object());
	assert!(upload_entry.get("chunkOutput").is_none());
}
