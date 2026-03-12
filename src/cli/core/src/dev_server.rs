/* src/cli/core/src/dev_server.rs */

// Embedded dev server: static files + reverse proxy + SPA fallback.
// Used when frontend.entry is set but no frontend.dev_command is configured.

use std::path::PathBuf;

use anyhow::Result;
use axum::Router;
use axum::body::Body;
use axum::extract::Request;
use axum::extract::State;
use axum::extract::ws::rejection::WebSocketUpgradeRejection;
use axum::extract::ws::{CloseCode, CloseFrame, Message, WebSocket, WebSocketUpgrade};
use axum::http::header::SEC_WEBSOCKET_PROTOCOL;
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode};
use axum::response::{Html, IntoResponse, Response};
use axum::routing::{any, get};
use futures_util::{SinkExt, StreamExt};
use reqwest::Url;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::{self, Message as TungsteniteMessage};
use tower_http::services::ServeDir;

use crate::build::types::AssetFiles;

#[derive(Clone)]
struct DevState {
	spa_html: String,
	backend_origin: String,
	client: reqwest::Client,
}

#[derive(Clone)]
struct FullstackDevState {
	backend_origin: String,
	vite_origin: String,
	client: reqwest::Client,
}

/// Generate minimal SPA HTML that boots the client in dev mode (id="root").
fn generate_spa_html(css_files: &[String], js_files: &[String]) -> String {
	let mut html = String::from(
		"<!DOCTYPE html><html><head><meta charset=\"utf-8\">\
     <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
	);
	for f in css_files {
		html.push_str(&format!(r#"<link rel="stylesheet" href="/assets/{f}">"#));
	}
	html.push_str("</head><body><div id=\"root\"></div>");
	for f in js_files {
		html.push_str(&format!(r#"<script type="module" src="/assets/{f}"></script>"#));
	}
	html.push_str("</body></html>");
	html
}

/// Forward request to backend, streaming the response back (important for SSE).
async fn proxy_handler(
	State(state): State<DevState>,
	req: Request<Body>,
) -> Result<Response, StatusCode> {
	proxy_http_request(&state.client, &state.backend_origin, req).await
}

/// SPA fallback: any non-asset, non-proxy route returns the SPA HTML.
async fn spa_fallback(State(state): State<DevState>) -> Html<String> {
	Html(state.spa_html.clone())
}

fn request_accepts_html(req: &Request<Body>) -> bool {
	req
		.headers()
		.get(axum::http::header::ACCEPT)
		.and_then(|value| value.to_str().ok())
		.is_some_and(|value| value.contains("text/html"))
}

fn ws_origin(http_origin: &str) -> String {
	if let Some(origin) = http_origin.strip_prefix("https://") {
		return format!("wss://{origin}");
	}
	if let Some(origin) = http_origin.strip_prefix("http://") {
		return format!("ws://{origin}");
	}
	http_origin.to_string()
}

fn copy_headers(
	mut builder: reqwest::RequestBuilder,
	headers: &axum::http::HeaderMap<HeaderValue>,
) -> reqwest::RequestBuilder {
	for (key, value) in headers {
		if key != "host" && key != axum::http::header::CONNECTION && key != axum::http::header::UPGRADE
		{
			builder = builder.header(key.as_str(), value.as_bytes());
		}
	}
	builder
}

async fn proxy_http_request(
	client: &reqwest::Client,
	target_origin: &str,
	req: Request<Body>,
) -> Result<Response, StatusCode> {
	let (parts, body) = req.into_parts();
	let mut url = Url::parse(target_origin).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
	url.set_path(parts.uri.path());
	url.set_query(parts.uri.query());

	let method = reqwest::Method::from_bytes(parts.method.as_str().as_bytes())
		.map_err(|_| StatusCode::BAD_REQUEST)?;
	let mut builder = client.request(method, url);
	builder = copy_headers(builder, &parts.headers);

	let body_bytes =
		axum::body::to_bytes(body, usize::MAX).await.map_err(|_| StatusCode::BAD_REQUEST)?;
	if !body_bytes.is_empty() {
		builder = builder.body(body_bytes);
	}

	let upstream = builder.send().await.map_err(|_| StatusCode::BAD_GATEWAY)?;
	let status =
		StatusCode::from_u16(upstream.status().as_u16()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
	let mut response = Response::builder().status(status);
	for (key, value) in upstream.headers() {
		response = response.header(key.as_str(), value.as_bytes());
	}
	let stream = upstream.bytes_stream();
	let body = Body::from_stream(stream);
	response.body(body).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

fn is_seam_path(path: &str) -> bool {
	path.starts_with("/_seam/")
}

async fn relay_client_to_upstream(
	mut client_socket: futures_util::stream::SplitStream<WebSocket>,
	mut upstream_socket: futures_util::stream::SplitSink<
		tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
		TungsteniteMessage,
	>,
) {
	while let Some(result) = client_socket.next().await {
		let Ok(message) = result else { break };
		let forward = match message {
			Message::Text(text) => TungsteniteMessage::Text(text.to_string().into()),
			Message::Binary(data) => TungsteniteMessage::Binary(data),
			Message::Ping(data) => TungsteniteMessage::Ping(data),
			Message::Pong(data) => TungsteniteMessage::Pong(data),
			Message::Close(frame) => {
				let close = frame.map(|frame| tungstenite::protocol::CloseFrame {
					code: tungstenite::protocol::frame::coding::CloseCode::from(frame.code),
					reason: frame.reason.to_string().into(),
				});
				let _ = upstream_socket.send(TungsteniteMessage::Close(close)).await;
				break;
			}
		};
		if upstream_socket.send(forward).await.is_err() {
			break;
		}
	}
}

async fn relay_upstream_to_client(
	mut upstream_socket: futures_util::stream::SplitStream<
		tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
	>,
	mut client_socket: futures_util::stream::SplitSink<WebSocket, Message>,
) {
	while let Some(result) = upstream_socket.next().await {
		let Ok(message) = result else { break };
		let forward = match message {
			TungsteniteMessage::Text(text) => Message::Text(text.to_string().into()),
			TungsteniteMessage::Binary(data) => Message::Binary(data),
			TungsteniteMessage::Ping(data) => Message::Ping(data),
			TungsteniteMessage::Pong(data) => Message::Pong(data),
			TungsteniteMessage::Close(frame) => {
				let close = frame.map(|frame| CloseFrame {
					code: CloseCode::from(u16::from(frame.code)),
					reason: frame.reason.to_string().into(),
				});
				let _ = client_socket.send(Message::Close(close)).await;
				break;
			}
			TungsteniteMessage::Frame(_) => continue,
		};
		if client_socket.send(forward).await.is_err() {
			break;
		}
	}
}

fn websocket_protocols(headers: &HeaderMap<HeaderValue>) -> Vec<String> {
	headers
		.get_all(SEC_WEBSOCKET_PROTOCOL)
		.iter()
		.filter_map(|value| value.to_str().ok())
		.flat_map(|value| value.split(','))
		.map(str::trim)
		.filter(|value| !value.is_empty())
		.map(ToOwned::to_owned)
		.collect()
}

fn build_upstream_websocket_request(
	target: &str,
	selected_protocol: Option<&HeaderValue>,
) -> Result<tungstenite::handshake::client::Request, StatusCode> {
	let mut request = target.into_client_request().map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
	if let Some(protocol) = selected_protocol {
		request.headers_mut().insert(SEC_WEBSOCKET_PROTOCOL, protocol.clone());
	}
	Ok(request)
}

async fn relay_websocket(
	socket: WebSocket,
	upstream_request: tungstenite::handshake::client::Request,
) {
	let Ok((upstream, _)) = connect_async(upstream_request).await else {
		return;
	};
	let (client_sink, client_stream) = socket.split();
	let (upstream_sink, upstream_stream) = upstream.split();
	let client_to_upstream = relay_client_to_upstream(client_stream, upstream_sink);
	let upstream_to_client = relay_upstream_to_client(upstream_stream, client_sink);
	let _ = tokio::join!(client_to_upstream, upstream_to_client);
}

async fn fullstack_proxy_handler(
	State(state): State<FullstackDevState>,
	ws: Result<WebSocketUpgrade, WebSocketUpgradeRejection>,
	req: Request<Body>,
) -> Result<Response, StatusCode> {
	let path = req.uri().path().to_string();
	if req.headers().contains_key(axum::http::header::UPGRADE) {
		let requested_protocols = websocket_protocols(req.headers());
		let ws: WebSocketUpgrade = ws.map_err(|_| StatusCode::BAD_REQUEST)?;
		let ws = if requested_protocols.is_empty() { ws } else { ws.protocols(requested_protocols) };
		let base = if is_seam_path(&path) { &state.backend_origin } else { &state.vite_origin };
		let mut url = Url::parse(&ws_origin(base)).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
		url.set_path(req.uri().path());
		url.set_query(req.uri().query());
		let upstream_request = build_upstream_websocket_request(url.as_str(), ws.selected_protocol())?;
		let response = ws.on_upgrade(move |socket| relay_websocket(socket, upstream_request));
		return Ok(response.into_response());
	}

	if is_seam_path(&path) || !matches!(req.method(), &Method::GET | &Method::HEAD) {
		return proxy_http_request(&state.client, &state.backend_origin, req).await;
	}

	let accepts_html = request_accepts_html(&req);
	if accepts_html {
		return proxy_http_request(&state.client, &state.backend_origin, req).await;
	}

	let (parts, body) = req.into_parts();
	let clone_method = parts.method.clone();
	let clone_uri = parts.uri.clone();
	let clone_headers = parts.headers.clone();
	let body_bytes =
		axum::body::to_bytes(body, usize::MAX).await.map_err(|_| StatusCode::BAD_REQUEST)?;

	let backend_req = Request::builder()
		.method(clone_method.clone())
		.uri(clone_uri.clone())
		.body(Body::from(body_bytes.clone()))
		.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
	let mut backend_req = backend_req;
	*backend_req.headers_mut() = clone_headers.clone();
	let backend_response =
		proxy_http_request(&state.client, &state.backend_origin, backend_req).await?;
	if backend_response.status() != StatusCode::NOT_FOUND {
		return Ok(backend_response);
	}

	let vite_req = Request::builder()
		.method(clone_method)
		.uri(clone_uri)
		.body(Body::from(body_bytes))
		.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
	let mut vite_req = vite_req;
	*vite_req.headers_mut() = clone_headers;
	proxy_http_request(&state.client, &state.vite_origin, vite_req).await
}

pub async fn start_dev_server(
	static_dir: PathBuf,
	dev_port: u16,
	backend_port: u16,
	assets: AssetFiles,
	public_dir: Option<PathBuf>,
) -> Result<()> {
	let spa_html = generate_spa_html(&assets.css, &assets.js);
	let state = DevState {
		spa_html,
		backend_origin: format!("http://localhost:{backend_port}"),
		client: reqwest::Client::new(),
	};

	// Static file serving for /assets/*
	let serve_assets = ServeDir::new(static_dir);

	let mut app = Router::new()
		// Proxy /_seam/* to backend
		.route(
			"/_seam/{*path}",
			get(proxy_handler).post(proxy_handler).put(proxy_handler).delete(proxy_handler),
		)
		// Serve static assets from dist/
		.nest_service("/assets", serve_assets);

	// When public/ exists, serve it at root path before SPA fallback.
	// ServeDir tries the file; on miss it falls through to the SPA.
	if let Some(ref pub_dir) = public_dir {
		let public_fallback = Router::new().fallback(spa_fallback).with_state(state.clone());
		app = app.fallback_service(ServeDir::new(pub_dir).fallback(public_fallback));
	} else {
		app = app.fallback(spa_fallback);
	}
	let app = app.with_state(state);

	let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{dev_port}")).await?;
	axum::serve(listener, app).await?;
	Ok(())
}

pub async fn start_fullstack_dev_server(
	public_port: u16,
	backend_port: u16,
	vite_port: u16,
) -> Result<()> {
	let state = FullstackDevState {
		backend_origin: format!("http://localhost:{backend_port}"),
		vite_origin: format!("http://localhost:{vite_port}"),
		client: reqwest::Client::new(),
	};

	let app = Router::new()
		.route("/{*path}", any(fullstack_proxy_handler))
		.route("/", any(fullstack_proxy_handler))
		.with_state(state);

	let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{public_port}")).await?;
	axum::serve(listener, app).await?;
	Ok(())
}

#[cfg(test)]
mod tests;
