/* packages/server/core/rust/src/build_loader/loader.rs */

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use crate::page::{LoaderDef, PageDef};

use super::types::{pick_template, LoaderConfig, ParamConfig, RouteManifest, RpcHashMap};

/// Build a LoaderInputFn closure from the loader config's param mappings.
/// For params with `from: "route"`, extracts the value from route params.
pub(super) fn build_input_fn(params: &HashMap<String, ParamConfig>) -> crate::page::LoaderInputFn {
  let params: Vec<(String, String, String)> = params
    .iter()
    .map(|(key, cfg)| (key.clone(), cfg.from.clone(), cfg.param_type.clone()))
    .collect();

  Arc::new(move |route_params: &HashMap<String, String>| {
    let mut obj = serde_json::Map::new();
    for (key, from, param_type) in &params {
      let value = match from.as_str() {
        "route" => {
          let raw = route_params.get(key).cloned().unwrap_or_default();
          match param_type.as_str() {
            "uint32" | "int32" | "number" => {
              if let Ok(n) = raw.parse::<i64>() {
                serde_json::Value::Number(serde_json::Number::from(n))
              } else {
                serde_json::Value::String(raw)
              }
            }
            _ => serde_json::Value::String(raw),
          }
        }
        _ => serde_json::Value::Null,
      };
      obj.insert(key.clone(), value);
    }
    serde_json::Value::Object(obj)
  })
}

/// Parse loaders JSON object into Vec<LoaderDef>.
pub(super) fn parse_loaders(loaders: &serde_json::Value) -> Vec<LoaderDef> {
  let Some(obj) = loaders.as_object() else {
    return Vec::new();
  };

  obj
    .iter()
    .filter_map(|(data_key, loader_val)| {
      let config: LoaderConfig = serde_json::from_value(loader_val.clone()).ok()?;
      Some(LoaderDef {
        data_key: data_key.clone(),
        procedure: config.procedure,
        input_fn: build_input_fn(&config.params),
      })
    })
    .collect()
}

/// Resolve a layout chain: walk from child to root, collecting templates.
/// Returns the full document template with <!--seam:outlet--> replaced by page content.
pub(super) fn resolve_layout_chain(
  layout_id: &str,
  page_template: &str,
  layouts: &HashMap<String, (String, Option<String>)>,
) -> String {
  let mut result = page_template.to_string();
  let mut current = Some(layout_id.to_string());

  while let Some(id) = current {
    if let Some((tmpl, parent)) = layouts.get(&id) {
      result = tmpl.replace("<!--seam:outlet-->", &result);
      current = parent.clone();
    } else {
      break;
    }
  }

  result
}

/// Load page definitions from seam build output on disk.
/// Reads route-manifest.json, loads templates, constructs PageDef with loaders.
#[allow(clippy::too_many_lines)]
pub fn load_build_output(dir: &str) -> Result<Vec<PageDef>, Box<dyn std::error::Error>> {
  let base = Path::new(dir);
  let manifest_path = base.join("route-manifest.json");
  let content = std::fs::read_to_string(&manifest_path)?;
  let manifest: RouteManifest = serde_json::from_str(&content)?;
  let default_locale = manifest.i18n.as_ref().map(|c| c.default.as_str());

  // Load layout templates (default locale)
  let mut layout_templates: HashMap<String, (String, Option<String>)> = HashMap::new();
  for (id, entry) in &manifest.layouts {
    if let Some(tmpl_path) = pick_template(&entry.template, &entry.templates, default_locale) {
      let full_path = base.join(&tmpl_path);
      let tmpl = std::fs::read_to_string(&full_path)?;
      layout_templates.insert(id.clone(), (tmpl, entry.parent.clone()));
    }
  }

  // Load layout templates per locale for locale-specific resolution
  let mut layout_locale_templates: HashMap<String, HashMap<String, (String, Option<String>)>> =
    HashMap::new();
  if manifest.i18n.is_some() {
    for (id, entry) in &manifest.layouts {
      if let Some(ref templates) = entry.templates {
        for (locale, tmpl_path) in templates {
          let full_path = base.join(tmpl_path);
          let tmpl = std::fs::read_to_string(&full_path)?;
          layout_locale_templates
            .entry(locale.clone())
            .or_default()
            .insert(id.clone(), (tmpl, entry.parent.clone()));
        }
      }
    }
  }

  let mut pages = Vec::new();

  for (route_path, entry) in &manifest.routes {
    // Load page template (default locale)
    let page_template =
      if let Some(tmpl_path) = pick_template(&entry.template, &entry.templates, default_locale) {
        let full_path = base.join(&tmpl_path);
        std::fs::read_to_string(&full_path)?
      } else {
        continue;
      };

    // Resolve layout chain if this page has a layout
    let template = if let Some(ref layout_id) = entry.layout {
      let mut full = resolve_layout_chain(layout_id, &page_template, &layout_templates);
      // Inject head_meta into layout's <head> if present
      if let Some(ref meta) = entry.head_meta {
        full = full.replace("</head>", &format!("{meta}</head>"));
      }
      full
    } else {
      page_template
    };

    // Build locale-specific pre-resolved templates when i18n is active
    let locale_templates = if manifest.i18n.is_some() {
      if let Some(ref templates) = entry.templates {
        let mut lt = HashMap::new();
        for (locale, tmpl_path) in templates {
          let full_path = base.join(tmpl_path);
          let page_tmpl = std::fs::read_to_string(&full_path)?;
          let resolved = if let Some(ref layout_id) = entry.layout {
            let locale_layouts = layout_locale_templates.get(locale).unwrap_or(&layout_templates);
            let mut full = resolve_layout_chain(layout_id, &page_tmpl, locale_layouts);
            if let Some(ref meta) = entry.head_meta {
              full = full.replace("</head>", &format!("{meta}</head>"));
            }
            full
          } else {
            page_tmpl
          };
          lt.insert(locale.clone(), resolved);
        }
        if lt.is_empty() {
          None
        } else {
          Some(lt)
        }
      } else {
        None
      }
    } else {
      None
    };

    // Convert route path from client format (/:param) to Axum format (/{param})
    let axum_route = convert_route_path(route_path);

    // Parse loaders: combine layout loaders + route loaders
    // Also build layout chain with per-layout loader key assignments
    let mut all_loaders = Vec::new();
    let mut layout_chain = Vec::new();
    if let Some(ref layout_id) = entry.layout {
      // Collect loaders from the layout chain (inner->outer walk)
      let mut chain = Some(layout_id.clone());
      while let Some(id) = chain {
        if let Some(layout_entry) = manifest.layouts.get(&id) {
          let layout_loaders = parse_loaders(&layout_entry.loaders);
          let loader_keys: Vec<String> =
            layout_loaders.iter().map(|l| l.data_key.clone()).collect();
          layout_chain.push(crate::page::LayoutChainEntry { id, loader_keys });
          all_loaders.extend(layout_loaders);
          chain = layout_entry.parent.clone();
        } else {
          break;
        }
      }
      // Reverse: walked inner->outer, want outer->inner (matching TS)
      layout_chain.reverse();
    }
    let page_loaders = parse_loaders(&entry.loaders);
    let page_loader_keys: Vec<String> = page_loaders.iter().map(|l| l.data_key.clone()).collect();
    all_loaders.extend(page_loaders);

    // Merge i18n_keys from layout chain + route
    let mut i18n_keys = Vec::new();
    if let Some(ref layout_id) = entry.layout {
      let mut chain = Some(layout_id.clone());
      while let Some(id) = chain {
        if let Some(layout_entry) = manifest.layouts.get(&id) {
          i18n_keys.extend(layout_entry.i18n_keys.iter().cloned());
          chain = layout_entry.parent.clone();
        } else {
          break;
        }
      }
    }
    i18n_keys.extend(entry.i18n_keys.iter().cloned());

    let data_id = manifest.data_id.clone().unwrap_or_else(|| "__data".to_string());
    pages.push(PageDef {
      route: axum_route,
      template,
      locale_templates,
      loaders: all_loaders,
      data_id: data_id.clone(),
      layout_chain,
      page_loader_keys,
      i18n_keys,
    });
  }

  Ok(pages)
}

/// Load i18n configuration and locale messages from build output.
/// Returns None when i18n is not configured.
pub fn load_i18n_config(dir: &str) -> Option<crate::page::I18nConfig> {
  let base = Path::new(dir);
  let manifest_path = base.join("route-manifest.json");
  let content = std::fs::read_to_string(&manifest_path).ok()?;
  let manifest: RouteManifest = serde_json::from_str(&content).ok()?;
  let i18n = manifest.i18n?;

  let mode = i18n.mode.unwrap_or_else(|| "memory".to_string());

  // Memory mode: preload route-keyed messages per locale from i18n/{locale}.json
  // Paged mode: store dist_dir for on-demand reads
  let mut messages = HashMap::new();
  if mode == "memory" {
    let i18n_dir = base.join("i18n");
    for locale in &i18n.locales {
      let locale_path = i18n_dir.join(format!("{locale}.json"));
      let parsed: HashMap<String, serde_json::Value> = std::fs::read_to_string(&locale_path)
        .ok()
        .and_then(|c| serde_json::from_str(&c).ok())
        .unwrap_or_default();
      messages.insert(locale.clone(), parsed);
    }
  }

  let dist_dir = if mode == "paged" { Some(base.to_path_buf()) } else { None };

  Some(crate::page::I18nConfig {
    locales: i18n.locales,
    default: i18n.default,
    mode,
    cache: i18n.cache,
    route_hashes: i18n.route_hashes,
    content_hashes: i18n.content_hashes,
    messages,
    dist_dir,
  })
}

/// Load the RPC hash map from build output (returns None when not present).
pub fn load_rpc_hash_map(dir: &str) -> Option<RpcHashMap> {
  let path = Path::new(dir).join("rpc-hash-map.json");
  let content = std::fs::read_to_string(&path).ok()?;
  serde_json::from_str(&content).ok()
}

/// Convert client route path to Axum format: /:param -> /{param}
pub(super) fn convert_route_path(path: &str) -> String {
  path
    .split('/')
    .map(|seg| {
      if let Some(param) = seg.strip_prefix(':') {
        format!("{{{param}}}")
      } else {
        seg.to_string()
      }
    })
    .collect::<Vec<_>>()
    .join("/")
}
