/* packages/cli/core/src/dev_server.rs */

// Embedded dev server: static files + reverse proxy + SPA fallback.
// Used when frontend.entry is set but no frontend.dev_command is configured.

use std::path::PathBuf;

use anyhow::Result;
use axum::body::Body;
use axum::extract::State;
use axum::http::{Request, StatusCode};
use axum::response::{Html, Response};
use axum::routing::get;
use axum::Router;
use tower_http::services::ServeDir;

#[derive(Clone)]
struct DevState {
  spa_html: String,
  backend_origin: String,
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
  let path_and_query = req.uri().path_and_query().map(|pq| pq.as_str()).unwrap_or(req.uri().path());
  let url = format!("{}{}", state.backend_origin, path_and_query);

  let method = reqwest::Method::from_bytes(req.method().as_str().as_bytes())
    .map_err(|_| StatusCode::BAD_REQUEST)?;

  let mut builder = state.client.request(method, &url);

  // Forward headers (skip host)
  for (key, value) in req.headers() {
    if key != "host" {
      builder = builder.header(key.as_str(), value.as_bytes());
    }
  }

  let body_bytes =
    axum::body::to_bytes(req.into_body(), usize::MAX).await.map_err(|_| StatusCode::BAD_REQUEST)?;

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

  // Stream the body back (reqwest -> axum Body)
  let stream = upstream.bytes_stream();
  let body = Body::from_stream(stream);
  response.body(body).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)
}

/// SPA fallback: any non-asset, non-proxy route returns the SPA HTML.
async fn spa_fallback(State(state): State<DevState>) -> Html<String> {
  Html(state.spa_html.clone())
}

pub struct AssetFiles {
  pub css: Vec<String>,
  pub js: Vec<String>,
}

pub async fn start_dev_server(
  static_dir: PathBuf,
  dev_port: u16,
  backend_port: u16,
  assets: AssetFiles,
) -> Result<()> {
  let spa_html = generate_spa_html(&assets.css, &assets.js);
  let state = DevState {
    spa_html,
    backend_origin: format!("http://localhost:{backend_port}"),
    client: reqwest::Client::new(),
  };

  // Static file serving for /assets/*
  let serve_assets = ServeDir::new(static_dir);

  let app = Router::new()
    // Proxy /_seam/* to backend
    .route(
      "/_seam/{*path}",
      get(proxy_handler).post(proxy_handler).put(proxy_handler).delete(proxy_handler),
    )
    // Serve static assets from dist/
    .nest_service("/assets", serve_assets)
    // SPA fallback for everything else
    .fallback(spa_fallback)
    .with_state(state);

  let listener = tokio::net::TcpListener::bind(format!("0.0.0.0:{dev_port}")).await?;
  axum::serve(listener, app).await?;
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn spa_html_contains_root_div() {
    let html = generate_spa_html(&["style-abc.css".into()], &["main-xyz.js".into()]);
    assert!(html.contains(r#"<div id="root">"#));
    assert!(html.contains(r#"href="/assets/style-abc.css""#));
    assert!(html.contains(r#"src="/assets/main-xyz.js""#));
    // Must NOT contain __SEAM_ROOT__ (that triggers hydration mode)
    assert!(!html.contains("__SEAM_ROOT__"));
  }

  #[test]
  fn spa_html_empty_assets() {
    let html = generate_spa_html(&[], &[]);
    assert!(html.contains(r#"<div id="root">"#));
    assert!(!html.contains("<link"));
    assert!(!html.contains("<script"));
  }
}
