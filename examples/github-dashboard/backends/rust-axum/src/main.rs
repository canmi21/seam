/* examples/github-dashboard/backends/rust-axum/src/main.rs */

mod procedures;

use std::env;

use seam_server::manifest::build_manifest;
use seam_server::SeamServer;
use seam_server_axum::IntoAxumRouter;

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
  let pages = seam_server::load_build_output(&build_dir).unwrap_or_default();

  let mut server = SeamServer::new()
    .procedure(get_session_procedure())
    .procedure(get_home_data_procedure())
    .procedure(get_user_procedure())
    .procedure(get_user_repos_procedure());

  for page in pages {
    server = server.page(page);
  }

  let router = server.into_axum_router();
  let listener = tokio::net::TcpListener::bind(&addr).await?;
  let actual_port = listener.local_addr()?.port();
  println!("GitHub Dashboard (rust-axum) running on http://localhost:{actual_port}");
  axum::serve(listener, router).await?;
  Ok(())
}
