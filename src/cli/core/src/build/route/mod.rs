/* src/cli/core/src/build/route/mod.rs */

// Build pipeline steps: skeleton rendering, route processing,
// manifest extraction, codegen, type checking, and asset packaging.

mod fnv;
mod helpers;
mod i18n_resolve;
mod manifest;
mod process;
mod projection;
mod ref_graph;
mod types;

#[cfg(test)]
mod tests;

// Re-export all public items for use by other modules
pub(crate) use helpers::{print_asset_files, read_i18n_messages};
pub(crate) use manifest::{
	extract_manifest, extract_manifest_command, generate_types, has_query_react_dep,
	package_static_assets, print_procedure_breakdown, run_typecheck, validate_invalidates,
};
pub(crate) use process::{
	BundleContext, RenderContext, apply_output_mode, export_i18n, process_routes,
	run_skeleton_renderer,
};
pub(crate) use projection::{inject_route_projections, report_narrowing_savings};
pub(crate) use ref_graph::{
	ProcedureRefGraph, build_reference_graph, generate_route_procedures_ts, inject_route_procedures,
	validate_handoff_consistency, validate_procedure_references, warn_unused_queries,
};
pub(crate) use types::{CacheStats, RouteManifest, SkeletonOutput};
