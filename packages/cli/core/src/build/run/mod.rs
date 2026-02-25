/* packages/cli/core/src/build/run/mod.rs */

// Build orchestrator: dispatches frontend-only (4 steps) or fullstack (7 steps) builds.

mod frontend;
mod fullstack;
mod helpers;
mod rebuild;

#[cfg(test)]
mod tests;

use std::path::Path;

use anyhow::Result;

use super::config::BuildConfig;
use crate::config::SeamConfig;

pub use helpers::RebuildMode;
pub use rebuild::run_incremental_rebuild;

// Re-export public wrappers for workspace module access
pub use helpers::maybe_generate_rpc_hashes_pub;
pub use rebuild::copy_wasm_binary_pub;

// Re-export for dev.rs
pub use fullstack::run_dev_build;

// -- Entry point --

pub fn run_build(config: &SeamConfig, base_dir: &Path) -> Result<()> {
  let build_config = BuildConfig::from_seam_config(config)?;
  if build_config.is_fullstack {
    fullstack::run_fullstack_build(config, &build_config, base_dir)
  } else {
    frontend::run_frontend_build(&build_config, base_dir)
  }
}
