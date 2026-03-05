/* src/cli/core/src/build/route/ref_graph.rs */

// Procedure reference graph: single-pass extraction from routes/layouts,
// consumed by validation and route-manifest generation.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use anyhow::{Context, Result, bail};

use super::manifest::did_you_mean;
use super::types::{RouteManifest, SkeletonOutput};
use crate::ui;
use seam_codegen::{CacheHint, Manifest, ProcedureType};

/// A direct reference from a loader to a procedure.
#[allow(dead_code)]
pub(crate) struct ProcedureConsumer {
  pub source: String,
  pub loader_key: String,
  pub is_layout: bool,
  pub handoff: bool,
}

/// A loader reference expanded through the layout chain for a specific route.
pub(crate) struct LoaderRef {
  pub loader_key: String,
  pub procedure: String,
  pub handoff: bool,
  pub params: Vec<String>,
}

pub(crate) struct ProcedureRefGraph {
  /// procedure name -> direct references from routes/layouts
  pub consumers: BTreeMap<String, Vec<ProcedureConsumer>>,
  /// route path -> all loader refs expanded through layout chain
  pub route_deps: BTreeMap<String, Vec<LoaderRef>>,
  /// all procedure names declared in manifest
  pub all_procedures: BTreeSet<String>,
}

/// Extract loader references from a loaders JSON object.
/// Combines the work of the old collect_loader_procedures and collect_loader_handoff_info.
fn collect_loader_refs(loaders: &serde_json::Value) -> Vec<LoaderRef> {
  let Some(obj) = loaders.as_object() else { return vec![] };
  let mut result = Vec::new();
  for (loader_key, loader_def) in obj {
    if let Some(procedure) = loader_def.get("procedure").and_then(|v| v.as_str()) {
      let handoff = loader_def.get("handoff").and_then(|v| v.as_str()) == Some("client");
      let params = loader_def
        .get("params")
        .and_then(|v| v.as_object())
        .map(|obj| obj.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
      result.push(LoaderRef {
        loader_key: loader_key.clone(),
        procedure: procedure.to_string(),
        handoff,
        params,
      });
    }
  }
  result
}

/// Build the reference graph from manifest and skeleton output in a single pass.
pub(crate) fn build_reference_graph(
  manifest: &Manifest,
  skeleton: &SkeletonOutput,
) -> ProcedureRefGraph {
  let all_procedures: BTreeSet<String> = manifest.procedures.keys().cloned().collect();
  let mut consumers: BTreeMap<String, Vec<ProcedureConsumer>> = BTreeMap::new();

  // Index layouts by id for O(1) chain walking
  let layout_map: BTreeMap<&str, &super::types::SkeletonLayout> =
    skeleton.layouts.iter().map(|l| (l.id.as_str(), l)).collect();

  // Collect layout loader refs (keyed by layout id)
  let mut layout_refs: BTreeMap<&str, Vec<LoaderRef>> = BTreeMap::new();
  for layout in &skeleton.layouts {
    let refs = collect_loader_refs(&layout.loaders);
    let source = format!("Layout \"{}\"", layout.id);
    for r in &refs {
      consumers.entry(r.procedure.clone()).or_default().push(ProcedureConsumer {
        source: source.clone(),
        loader_key: r.loader_key.clone(),
        is_layout: true,
        handoff: r.handoff,
      });
    }
    layout_refs.insert(&layout.id, refs);
  }

  // Collect route loader refs and build route_deps (route + layout chain)
  let mut route_deps: BTreeMap<String, Vec<LoaderRef>> = BTreeMap::new();
  for route in &skeleton.routes {
    let refs = collect_loader_refs(&route.loaders);
    let source = format!("Route \"{}\"", route.path);
    for r in &refs {
      consumers.entry(r.procedure.clone()).or_default().push(ProcedureConsumer {
        source: source.clone(),
        loader_key: r.loader_key.clone(),
        is_layout: false,
        handoff: r.handoff,
      });
    }

    // Expand layout chain
    let mut all_refs: Vec<LoaderRef> = refs
      .into_iter()
      .map(|r| LoaderRef {
        loader_key: r.loader_key,
        procedure: r.procedure,
        handoff: r.handoff,
        params: r.params,
      })
      .collect();

    if let Some(layout_id) = &route.layout {
      let mut current_id = Some(layout_id.as_str());
      while let Some(id) = current_id {
        if let Some(layout) = layout_map.get(id) {
          if let Some(lrefs) = layout_refs.get(id) {
            for r in lrefs {
              all_refs.push(LoaderRef {
                loader_key: r.loader_key.clone(),
                procedure: r.procedure.clone(),
                handoff: r.handoff,
                params: r.params.clone(),
              });
            }
          }
          current_id = layout.parent.as_deref();
        } else {
          break;
        }
      }
    }

    route_deps.insert(route.path.clone(), all_refs);
  }

  ProcedureRefGraph { consumers, route_deps, all_procedures }
}

/// Validate that all procedure references in routes/layouts exist in the manifest.
pub(crate) fn validate_procedure_references(graph: &ProcedureRefGraph) -> Result<()> {
  let available: Vec<&str> = graph.all_procedures.iter().map(String::as_str).collect();
  let mut errors = Vec::new();

  for (proc_name, refs) in &graph.consumers {
    if graph.all_procedures.contains(proc_name) {
      continue;
    }
    for consumer in refs {
      let mut block = format!(
        "  {} loader \"{}\" references procedure \"{proc_name}\",\n  \
         but no procedure with that name is registered.\n\n  \
         Available procedures: {}",
        consumer.source,
        consumer.loader_key,
        available.join(", ")
      );
      if let Some(suggestion) = did_you_mean(proc_name, &available) {
        block.push_str(&format!("\n\n  Did you mean: {suggestion}?"));
      }
      errors.push(block);
    }
  }

  if errors.is_empty() {
    return Ok(());
  }

  bail!("unknown procedure reference\n\n{}", errors.join("\n\n"));
}

/// Warn when the same procedure appears in both handoff and non-handoff loaders
/// within the same page (including its layout chain).
pub(crate) fn validate_handoff_consistency(graph: &ProcedureRefGraph) {
  for (route_path, refs) in &graph.route_deps {
    // Group by procedure name
    let mut by_proc: BTreeMap<&str, (Vec<&str>, Vec<&str>)> = BTreeMap::new();
    for r in refs {
      let entry = by_proc.entry(&r.procedure).or_default();
      if r.handoff {
        entry.0.push(&r.loader_key);
      } else {
        entry.1.push(&r.loader_key);
      }
    }

    for (handoff_keys, non_handoff_keys) in by_proc.values() {
      if !handoff_keys.is_empty() && !non_handoff_keys.is_empty() {
        ui::warn(&format!(
          "Route \"{route_path}\" has loaders {} (handoff) and {} sharing the same procedure. \
           These share the same data source but have different update mechanisms after hydration.",
          handoff_keys.iter().map(|k| format!("\"{k}\"")).collect::<Vec<_>>().join(", "),
          non_handoff_keys.iter().map(|k| format!("\"{k}\"")).collect::<Vec<_>>().join(", "),
        ));
      }
    }
  }
}

/// Warn when a query procedure has no loader references and is not suppressed.
pub(crate) fn warn_unused_queries(graph: &ProcedureRefGraph, manifest: &Manifest) {
  for name in &graph.all_procedures {
    if graph.consumers.contains_key(name) {
      continue;
    }
    let Some(schema) = manifest.procedures.get(name) else { continue };
    if schema.proc_type != seam_codegen::ProcedureType::Query {
      continue;
    }
    if let Some(suppress) = &schema.suppress
      && suppress.iter().any(|s| s == "unused")
    {
      continue;
    }
    ui::warn(&format!(
      "query \"{name}\" is not referenced by any loader. \
       If this is intentional, add `suppress: [\"unused\"]` to the procedure definition.",
    ));
  }
}

/// Inject sorted unique procedure names from the ref graph into route manifest entries.
pub(crate) fn inject_route_procedures(
  route_manifest: &mut RouteManifest,
  graph: &ProcedureRefGraph,
) {
  for (path, entry) in &mut route_manifest.routes {
    if let Some(deps) = graph.route_deps.get(path) {
      let mut procs: Vec<String> = deps.iter().map(|r| r.procedure.clone()).collect();
      procs.sort();
      procs.dedup();
      if !procs.is_empty() {
        entry.procedures = Some(procs);
      }
    }
  }
}

/// Generate `.seam/generated/route-procedures.ts` with per-route procedure info.
pub(crate) fn generate_route_procedures_ts(
  graph: &ProcedureRefGraph,
  manifest: &Manifest,
  output_path: &Path,
) -> Result<()> {
  let mut lines = Vec::new();
  lines.push("/* .seam/generated/route-procedures.ts */\n".to_string());
  lines.push("export const seamRouteProcedures = {".to_string());

  for (route_path, deps) in &graph.route_deps {
    // Sorted unique procedure names
    let mut all: Vec<String> = deps.iter().map(|r| r.procedure.clone()).collect();
    all.sort();
    all.dedup();

    // Collect prefetchable: query procedures with cache config
    let mut prefetchable: BTreeMap<&str, (u64, Vec<String>)> = BTreeMap::new();
    for dep in deps {
      if prefetchable.contains_key(dep.procedure.as_str()) {
        continue;
      }
      if let Some(schema) = manifest.procedures.get(&dep.procedure)
        && schema.proc_type == ProcedureType::Query
        && let Some(CacheHint::Config { ttl }) = &schema.cache
      {
        let mut params = dep.params.clone();
        params.sort();
        prefetchable.insert(&dep.procedure, (*ttl, params));
      }
    }

    let all_str = all.iter().map(|s| format!("\"{s}\"")).collect::<Vec<_>>().join(", ");
    lines.push(format!("  \"{route_path}\": {{"));
    lines.push(format!("    all: [{all_str}],"));
    lines.push("    prefetchable: {".to_string());
    for (proc_name, (ttl, params)) in &prefetchable {
      let params_str = params.iter().map(|p| format!("\"{p}\"")).collect::<Vec<_>>().join(", ");
      lines.push(format!("      \"{proc_name}\": {{ ttl: {ttl}, params: [{params_str}] }},",));
    }
    lines.push("    },".to_string());
    lines.push("  },".to_string());
  }

  lines.push("} as const;\n".to_string());
  lines.push("export type SeamRouteProcedures = typeof seamRouteProcedures;\n".to_string());

  let content = lines.join("\n");
  if let Some(parent) = output_path.parent() {
    std::fs::create_dir_all(parent)
      .with_context(|| format!("failed to create {}", parent.display()))?;
  }
  std::fs::write(output_path, content)
    .with_context(|| format!("failed to write {}", output_path.display()))?;
  Ok(())
}
