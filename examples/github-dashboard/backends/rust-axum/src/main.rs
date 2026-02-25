/* examples/github-dashboard/backends/rust-axum/src/main.rs */

mod procedures;

use std::env;
use std::path::PathBuf;

use axum::extract::Request;
use axum::response::IntoResponse;
use axum::routing::get_service;
use seam_server::manifest::build_manifest;
use seam_server::SeamServer;
use seam_server_axum::IntoAxumRouter;
use tower::ServiceExt;
use tower_http::services::ServeDir;

use procedures::{
  get_home_data_procedure, get_session_procedure, get_user_procedure, get_user_repos_procedure,
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
  // --manifest flag: print procedure manifest JSON to stdout and exit
  if env::args().any(|a| a == "--manifest") {
    let procs = vec![
      get_session_procedure(),
      get_home_data_procedure(),
      get_user_procedure(),
      get_user_repos_procedure(),
    ];
    let manifest = build_manifest(&procs, &[]);
    println!("{}", serde_json::to_string(&manifest)?);
    return Ok(());
  }

  let port = env::var("PORT").unwrap_or_else(|_| "3000".to_string());
  let addr = format!("0.0.0.0:{port}");

  // Load pages from build output if available
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

  let mut server = SeamServer::new()
    .procedure(get_session_procedure())
    .procedure(get_home_data_procedure())
    .procedure(get_user_procedure())
    .procedure(get_user_repos_procedure());

  // Load RPC hash map for production hashed procedure names
  if let Some(hash_map) = seam_server::load_rpc_hash_map(&build_dir) {
    eprintln!("RPC hash map loaded ({} procedures)", hash_map.procedures.len());
    server = server.rpc_hash_map(hash_map);
  }

  for page in pages {
    server = server.page(page);
  }

  // The seam adapter serves pages under /_seam/page/* only — it deliberately
  // avoids claiming root paths so the application retains full control over
  // its URL space (public APIs, auth endpoints, static files, etc.).
  //
  // Static assets and root-path page serving are the application's responsibility.
  let static_dir = PathBuf::from(&build_dir).join("public");
  let seam_router =
    server.into_axum_router().nest_service("/_seam/static", get_service(ServeDir::new(static_dir)));

  // Fallback: rewrite unmatched GET requests to /_seam/page/* for page serving.
  let page_forwarder = seam_router.clone();
  let router = seam_router.fallback(move |req: Request| {
    let svc = page_forwarder.clone();
    async move {
      if req.method() != axum::http::Method::GET {
        return axum::http::StatusCode::NOT_FOUND.into_response();
      }
      let path = req.uri().path().to_string();
      let new_uri: axum::http::Uri = format!("/_seam/page{path}").parse().expect("valid URI");
      let (mut parts, body) = req.into_parts();
      parts.uri = new_uri;
      svc.oneshot(Request::from_parts(parts, body)).await.into_response()
    }
  });

  let listener = tokio::net::TcpListener::bind(&addr).await?;
  let actual_port = listener.local_addr()?.port();
  println!("GitHub Dashboard (rust-axum) running on http://localhost:{actual_port}");
  axum::serve(listener, router).await?;
  Ok(())
}
