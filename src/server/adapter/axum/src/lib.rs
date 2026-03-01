/* src/server/adapter/axum/src/lib.rs */

mod error;
mod handler;

use std::sync::Arc;

use seam_server::manifest::build_manifest;
use seam_server::SeamServer;

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
    )
  }

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

  #[test]
  fn into_axum_router_builds_without_panic() {
    let server = SeamServer::new();
    let _router = server.into_axum_router();
  }
}
