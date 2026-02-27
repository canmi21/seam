/* packages/cli/core/src/build/route/mod.rs */

// Build pipeline steps: skeleton rendering, route processing,
// manifest extraction, codegen, type checking, and asset packaging.

mod helpers;
mod manifest;
mod process;
mod types;

#[cfg(test)]
mod tests;

// Re-export all public items for use by other modules
pub(crate) use helpers::{export_i18n_messages, print_asset_files, read_i18n_messages};
pub(crate) use manifest::{
  extract_manifest, extract_manifest_command, generate_types, package_static_assets,
  print_procedure_breakdown, run_typecheck, validate_procedure_references,
};
pub(crate) use process::{process_routes, run_skeleton_renderer};
pub(crate) use types::CacheStats;
