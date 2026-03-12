/* src/cli/core/src/dev_server/tests.rs */

use super::*;
use axum::body::Body;
use axum::http::Request as HttpRequest;
use axum::http::header::SEC_WEBSOCKET_PROTOCOL;
use axum::routing::get;
use futures_util::{SinkExt, StreamExt};
use std::net::TcpListener;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;

#[test]
fn spa_html_contains_root_div() {
	let html = generate_spa_html(&["style-abc.css".into()], &["main-xyz.js".into()]);
	assert!(html.contains(r#"<div id="root">"#));
	assert!(html.contains(r#"href="/assets/style-abc.css""#));
	assert!(html.contains(r#"src="/assets/main-xyz.js""#));
	assert!(!html.contains("__seam"));
}

#[test]
fn spa_html_empty_assets() {
	let html = generate_spa_html(&[], &[]);
	assert!(html.contains(r#"<div id="root">"#));
	assert!(!html.contains("<link"));
	assert!(!html.contains("<script"));
}

#[test]
fn detects_html_navigation_requests() {
	let req = HttpRequest::builder()
		.header("accept", "text/html,application/xhtml+xml")
		.body(Body::empty())
		.unwrap();
	assert!(request_accepts_html(&req));
}

#[test]
fn ignores_non_html_asset_requests() {
	let req = HttpRequest::builder().header("accept", "*/*").body(Body::empty()).unwrap();
	assert!(!request_accepts_html(&req));
}

fn free_port() -> u16 {
	let listener = TcpListener::bind("127.0.0.1:0").unwrap();
	let port = listener.local_addr().unwrap().port();
	drop(listener);
	port
}

async fn spawn_http_server(router: Router) -> (u16, JoinHandle<()>) {
	let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
	let port = listener.local_addr().unwrap().port();
	let handle = tokio::spawn(async move {
		axum::serve(listener, router).await.unwrap();
	});
	(port, handle)
}

#[tokio::test]
async fn fullstack_proxy_routes_html_to_backend_and_modules_to_vite() {
	let backend_router = Router::new()
		.route("/dashboard", get(|| async { Html("<html>backend</html>".to_string()) }))
		.route("/_seam/manifest.json", get(|| async { "manifest" }))
		.route("/src/client/main.tsx", get(|| async { (StatusCode::NOT_FOUND, "missing") }));
	let vite_router = Router::new()
		.route("/src/client/main.tsx", get(|| async { "console.log('vite')" }))
		.route("/@vite/client", get(|| async { "vite-client" }));

	let (backend_port, backend_handle) = spawn_http_server(backend_router).await;
	let (vite_port, vite_handle) = spawn_http_server(vite_router).await;
	let public_port = free_port();
	let proxy_handle = tokio::spawn(async move {
		start_fullstack_dev_server(public_port, backend_port, vite_port).await.unwrap();
	});

	tokio::time::sleep(std::time::Duration::from_millis(150)).await;

	let client = reqwest::Client::new();
	let html = client
		.get(format!("http://127.0.0.1:{public_port}/dashboard"))
		.header("accept", "text/html")
		.send()
		.await
		.unwrap()
		.text()
		.await
		.unwrap();
	assert!(html.contains("backend"));

	let module = client
		.get(format!("http://127.0.0.1:{public_port}/src/client/main.tsx"))
		.header("accept", "*/*")
		.send()
		.await
		.unwrap()
		.text()
		.await
		.unwrap();
	assert!(module.contains("vite"));

	let manifest = client
		.get(format!("http://127.0.0.1:{public_port}/_seam/manifest.json"))
		.send()
		.await
		.unwrap()
		.text()
		.await
		.unwrap();
	assert_eq!(manifest, "manifest");

	proxy_handle.abort();
	backend_handle.abort();
	vite_handle.abort();
}

#[tokio::test]
async fn fullstack_proxy_preserves_websocket_subprotocol_for_vite_hmr() {
	let backend_router = Router::new().route("/", get(|| async { "backend" }));
	let (protocol_tx, mut protocol_rx) = mpsc::unbounded_channel();
	let vite_router = Router::new().route(
		"/",
		any(move |ws: WebSocketUpgrade| {
			let protocol_tx = protocol_tx.clone();
			async move {
				ws.protocols(["vite-hmr"]).on_upgrade(move |mut socket| async move {
					let negotiated_protocol =
						socket.protocol().and_then(|value| value.to_str().ok()).unwrap_or_default().to_string();
					let _ = protocol_tx.send(negotiated_protocol);
					let _ = socket.send(Message::Text("vite-ready".into())).await;
					while let Some(Ok(message)) = socket.recv().await {
						if let Message::Text(text) = message {
							let _ = socket.send(Message::Text(text)).await;
							break;
						}
					}
				})
			}
		}),
	);

	let (backend_port, backend_handle) = spawn_http_server(backend_router).await;
	let (vite_port, vite_handle) = spawn_http_server(vite_router).await;
	let public_port = free_port();
	let proxy_handle = tokio::spawn(async move {
		start_fullstack_dev_server(public_port, backend_port, vite_port).await.unwrap();
	});

	tokio::time::sleep(std::time::Duration::from_millis(150)).await;

	let mut request =
		format!("ws://127.0.0.1:{public_port}/?token=test").into_client_request().unwrap();
	request.headers_mut().insert(SEC_WEBSOCKET_PROTOCOL, HeaderValue::from_static("vite-hmr"));
	let (mut socket, response) = connect_async(request).await.unwrap();
	assert_eq!(
		response.headers().get(SEC_WEBSOCKET_PROTOCOL),
		Some(&HeaderValue::from_static("vite-hmr"))
	);
	assert_eq!(protocol_rx.recv().await.as_deref(), Some("vite-hmr"));

	let initial = socket.next().await.unwrap().unwrap();
	assert_eq!(initial, TungsteniteMessage::Text("vite-ready".into()));
	socket.send(TungsteniteMessage::Text("ping".into())).await.unwrap();
	let echoed = socket.next().await.unwrap().unwrap();
	assert_eq!(echoed, TungsteniteMessage::Text("ping".into()));

	proxy_handle.abort();
	backend_handle.abort();
	vite_handle.abort();
}
