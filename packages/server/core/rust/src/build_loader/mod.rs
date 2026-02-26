/* packages/server/core/rust/src/build_loader/mod.rs */

// Load page definitions from seam build output on disk.
// Reads route-manifest.json, loads templates, constructs PageDef with loaders.

mod loader;
mod types;

#[cfg(test)]
mod tests;

pub use loader::{load_build_output, load_i18n_config, load_rpc_hash_map};
pub use types::RpcHashMap;
