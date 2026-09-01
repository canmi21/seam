/* src/server/core/rust/src/build_loader/mod.rs */

// Load page definitions from seam build output on disk.
// Reads route-manifest.json, loads templates, constructs PageDef with loaders.

mod loader;
mod types;

#[cfg(test)]
mod tests;

use std::path::PathBuf;

use crate::page::{I18nConfig, PageDef};

pub use loader::{load_build_output, load_i18n_config, load_rpc_hash_map};
pub use types::RpcHashMap;

pub struct BuildOutput {
	pub pages: Vec<PageDef>,
	pub rpc_hash_map: Option<RpcHashMap>,
	pub i18n_config: Option<I18nConfig>,
	pub public_dir: Option<PathBuf>,
}

pub fn load_public_dir(dir: &str) -> Option<PathBuf> {
	if let Ok(explicit_dir) = std::env::var("SEAM_PUBLIC_DIR") {
		let path = PathBuf::from(explicit_dir);
		if path.is_dir() {
			return Some(path);
		}
	}

	let public_root = PathBuf::from(dir).join("public-root");
	if public_root.is_dir() {
		return Some(public_root);
	}

	None
}

pub fn load_build(dir: &str) -> Result<BuildOutput, Box<dyn std::error::Error>> {
	Ok(BuildOutput {
		pages: load_build_output(dir)?,
		rpc_hash_map: load_rpc_hash_map(dir),
		i18n_config: load_i18n_config(dir),
		public_dir: load_public_dir(dir),
	})
}
