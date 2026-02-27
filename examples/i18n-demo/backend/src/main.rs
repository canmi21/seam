/* examples/i18n-demo/backend/src/main.rs */

use std::env;
use std::path::PathBuf;

use axum::extract::Request;
use axum::response::IntoResponse;
use axum::routing::get_service;
use seam_server::manifest::build_manifest;
use seam_server::{from_accept_language, from_cookie, from_url_prefix, from_url_query, SeamServer};
use seam_server::{seam_procedure, SeamError, SeamType};
use seam_server_axum::IntoAxumRouter;
use serde::{Deserialize, Serialize};
use tower::ServiceExt;
use tower_http::services::ServeDir;

// -- getContent procedure --

#[derive(Deserialize, SeamType)]
pub struct ContentInput {}

#[derive(Serialize, SeamType)]
pub struct ContentOutput {
  pub mode: String,
}

#[seam_procedure(name = "getContent")]
pub async fn get_content(_input: ContentInput) -> Result<ContentOutput, SeamError> {
  let mode = env::var("I18N_MODE").unwrap_or_else(|_| "prefix".to_string());
  Ok(ContentOutput { mode })
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
  if env::args().any(|a| a == "--manifest") {
    let procs = vec![get_content_procedure()];
    let manifest = build_manifest(&procs, &[]);
    println!("{}", serde_json::to_string(&manifest)?);
    return Ok(());
  }

  let port = env::var("PORT").unwrap_or_else(|_| "3000".to_string());
  let addr = format!("0.0.0.0:{port}");

  let build_dir = env::var("SEAM_OUTPUT_DIR").unwrap_or_else(|_| ".seam/output".to_string());
  let pages = match seam_server::load_build_output(&build_dir) {
    Ok(p) => {
      eprintln!("Loaded {} pages from {build_dir}", p.len());
      p
    }
    Err(e) => {
      eprintln!("No build output at {build_dir}: {e} (API-only mode)");
      vec![]
    }
  };

  let mode = env::var("I18N_MODE").unwrap_or_else(|_| "prefix".to_string());
  eprintln!("i18n mode: {mode}");

  let mut server = SeamServer::new().procedure(get_content_procedure());

  if let Some(hash_map) = seam_server::load_rpc_hash_map(&build_dir) {
    eprintln!("RPC hash map loaded ({} procedures)", hash_map.procedures.len());
    server = server.rpc_hash_map(hash_map);
  }

  if let Some(i18n_config) = seam_server::load_i18n_config(&build_dir) {
    eprintln!("i18n: {} locales, default={}", i18n_config.locales.len(), i18n_config.default);
    server = server.i18n_config(i18n_config);
  }

  // Resolve strategies based on mode
  match mode.as_str() {
    "hidden" => {
      server = server.resolve_strategies(vec![
        from_url_query("lang"),
        from_cookie("seam-locale"),
        from_accept_language(),
      ]);
    }
    _ => {
      server = server.resolve_strategies(vec![from_url_prefix()]);
    }
  }

  for page in pages {
    server = server.page(page);
  }

  let static_dir = PathBuf::from(&build_dir).join("public");
  let seam_router =
    server.into_axum_router().nest_service("/_seam/static", get_service(ServeDir::new(static_dir)));

  let page_forwarder = seam_router.clone();
  let router = seam_router.fallback(move |req: Request| {
    let svc = page_forwarder.clone();
    async move {
      if req.method() != axum::http::Method::GET {
        return axum::http::StatusCode::NOT_FOUND.into_response();
      }
      let path = req.uri().path().to_string();
      let query = req.uri().query().map(|q| format!("?{q}")).unwrap_or_default();
      let new_uri: axum::http::Uri =
        format!("/_seam/page{path}{query}").parse().expect("valid URI");
      let (mut parts, body) = req.into_parts();
      parts.uri = new_uri;
      svc.oneshot(Request::from_parts(parts, body)).await.into_response()
    }
  });

  let listener = tokio::net::TcpListener::bind(&addr).await?;
  let actual_port = listener.local_addr()?.port();
  println!("i18n-demo (rust-axum) running on http://localhost:{actual_port}");
  axum::serve(listener, router).await?;
  Ok(())
}
