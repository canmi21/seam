/* packages/cli/core/src/build/route/process.rs */

use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;

use anyhow::{bail, Context, Result};

use super::super::ctr_check;
use super::super::skeleton::{
  extract_head_metadata, extract_template, sentinel_to_slots, wrap_document,
};
use super::super::slot_warning;
use super::super::types::{AssetFiles, ViteDevInfo};
use super::helpers::path_to_filename;
use super::types::{
  I18nManifest, LayoutManifestEntry, RouteManifest, RouteManifestEntry, SkeletonLayout,
  SkeletonOutput, SkeletonRoute,
};
use crate::config::I18nSection;
use crate::shell::which_exists;
use crate::ui::{self, DIM, RESET, YELLOW};

pub(crate) fn run_skeleton_renderer(
  script_path: &Path,
  routes_path: &Path,
  manifest_path: &Path,
  base_dir: &Path,
  i18n: Option<&I18nSection>,
) -> Result<SkeletonOutput> {
  let runtime = if which_exists("bun") { "bun" } else { "node" };

  // Build i18n JSON argument: read locale message files and serialize as a single blob
  let i18n_arg = match i18n {
    Some(cfg) => {
      let mut messages = serde_json::Map::new();
      for locale in &cfg.locales {
        let path = base_dir.join(&cfg.messages_dir).join(format!("{locale}.json"));
        let content = std::fs::read_to_string(&path)
          .with_context(|| format!("i18n: failed to read {}", path.display()))?;
        let parsed: serde_json::Value = serde_json::from_str(&content)
          .with_context(|| format!("i18n: invalid JSON in {}", path.display()))?;
        messages.insert(locale.clone(), parsed);
      }
      serde_json::to_string(&serde_json::json!({
        "locales": cfg.locales,
        "default": cfg.default,
        "messages": messages,
      }))?
    }
    None => "none".to_string(),
  };

  let output = Command::new(runtime)
    .arg(script_path)
    .arg(routes_path)
    .arg(manifest_path)
    .arg(&i18n_arg)
    .current_dir(base_dir)
    .output()
    .with_context(|| format!("failed to spawn {runtime} for skeleton rendering"))?;

  if !output.status.success() {
    let stderr = String::from_utf8_lossy(&output.stderr);
    bail!("skeleton rendering failed:\n{stderr}");
  }

  let stdout = String::from_utf8(output.stdout).context("invalid UTF-8 from skeleton renderer")?;
  serde_json::from_str(&stdout).context("failed to parse skeleton output JSON")
}

#[allow(clippy::too_many_arguments, clippy::too_many_lines)]
pub(crate) fn process_routes(
  layouts: &[SkeletonLayout],
  routes: &[SkeletonRoute],
  templates_dir: &Path,
  assets: &AssetFiles,
  dev_mode: bool,
  vite: Option<&ViteDevInfo>,
  root_id: &str,
  data_id: &str,
  i18n: Option<&I18nSection>,
  i18n_versions: Option<&BTreeMap<String, String>>,
) -> Result<RouteManifest> {
  let manifest_data_id = if data_id == "__SEAM_DATA__" { None } else { Some(data_id.to_string()) };
  let i18n_manifest = i18n.map(|cfg| I18nManifest {
    locales: cfg.locales.clone(),
    default: cfg.default.clone(),
    versions: i18n_versions.cloned(),
  });
  let mut manifest = RouteManifest {
    layouts: BTreeMap::new(),
    routes: BTreeMap::new(),
    data_id: manifest_data_id,
    i18n: i18n_manifest,
  };

  // Process layouts
  for layout in layouts {
    if let Some(ref locale_html) = layout.locale_html {
      // i18n ON: write per-locale templates
      let mut templates = BTreeMap::new();
      for (locale, html) in locale_html {
        let html = html.replace("<seam-outlet></seam-outlet>", "<!--seam:outlet-->");
        let html = sentinel_to_slots(&html);
        let document = wrap_document(&html, &assets.css, &assets.js, dev_mode, vite, root_id);
        let locale_dir = templates_dir.join(locale);
        std::fs::create_dir_all(&locale_dir)
          .with_context(|| format!("failed to create {}", locale_dir.display()))?;
        let filename = format!("{}.html", layout.id);
        let filepath = locale_dir.join(&filename);
        std::fs::write(&filepath, &document)
          .with_context(|| format!("failed to write {}", filepath.display()))?;
        let template_rel = format!("templates/{locale}/{filename}");
        templates.insert(locale.clone(), template_rel);
      }
      ui::detail_ok(&format!("layout {} -> {} locales", layout.id, locale_html.len()));
      manifest.layouts.insert(
        layout.id.clone(),
        LayoutManifestEntry {
          template: None,
          templates: Some(templates),
          loaders: layout.loaders.clone(),
          parent: layout.parent.clone(),
          i18n_keys: layout.i18n_keys.clone(),
        },
      );
    } else if let Some(ref html) = layout.html {
      // i18n OFF: single template (original behavior)
      let html = html.replace("<seam-outlet></seam-outlet>", "<!--seam:outlet-->");
      let html = sentinel_to_slots(&html);
      let document = wrap_document(&html, &assets.css, &assets.js, dev_mode, vite, root_id);
      let filename = format!("{}.html", layout.id);
      let filepath = templates_dir.join(&filename);
      std::fs::write(&filepath, &document)
        .with_context(|| format!("failed to write {}", filepath.display()))?;
      let template_rel = format!("templates/{filename}");
      ui::detail_ok(&format!("layout {} -> {template_rel}", layout.id));
      manifest.layouts.insert(
        layout.id.clone(),
        LayoutManifestEntry {
          template: Some(template_rel),
          templates: None,
          loaders: layout.loaders.clone(),
          parent: layout.parent.clone(),
          i18n_keys: layout.i18n_keys.clone(),
        },
      );
    }
  }

  // Process routes
  for route in routes {
    if let Some(ref locale_variants) = route.locale_variants {
      // i18n ON: write per-locale templates
      let mut templates = BTreeMap::new();
      for (locale, data) in locale_variants {
        let processed: Vec<_> = data.variants.iter().map(|v| sentinel_to_slots(&v.html)).collect();
        let template = extract_template(&data.axes, &processed);

        ctr_check::verify_ctr_equivalence(&route.path, &data.mock_html, &template, &route.mock)?;

        if let Some(schema) = &route.page_schema {
          for w in slot_warning::check_slot_types(&template, schema) {
            ui::detail(&format!("{YELLOW}warning{RESET}: {} [{locale}] {w}", route.path));
          }
        }

        let (document, head_meta) = if route.layout.is_some() {
          if dev_mode {
            (template.clone(), None)
          } else {
            let (meta, body) = extract_head_metadata(&template);
            let hm = if meta.is_empty() { None } else { Some(meta.to_string()) };
            (body.to_string(), hm)
          }
        } else {
          let doc = wrap_document(&template, &assets.css, &assets.js, dev_mode, vite, root_id);
          (doc, None)
        };

        let locale_dir = templates_dir.join(locale);
        std::fs::create_dir_all(&locale_dir)
          .with_context(|| format!("failed to create {}", locale_dir.display()))?;
        let filename = path_to_filename(&route.path);
        let filepath = locale_dir.join(&filename);
        std::fs::write(&filepath, &document)
          .with_context(|| format!("failed to write {}", filepath.display()))?;

        let template_rel = format!("templates/{locale}/{filename}");
        templates.insert(locale.clone(), template_rel);

        // Store head_meta from the default locale only
        if i18n.is_some_and(|cfg| locale == &cfg.default) {
          manifest.routes.entry(route.path.clone()).or_insert_with(|| RouteManifestEntry {
            template: None,
            templates: None,
            layout: route.layout.clone(),
            loaders: route.loaders.clone(),
            head_meta,
            i18n_keys: route.i18n_keys.clone(),
          });
        }
      }

      let size = locale_variants.values().next().map(|d| d.mock_html.len() as u64).unwrap_or(0);
      ui::detail_ok(&format!(
        "{}  \u{2192} {} locales  {DIM}(~{}){RESET}",
        route.path,
        locale_variants.len(),
        ui::format_size(size)
      ));

      // Update the entry with templates map
      if let Some(entry) = manifest.routes.get_mut(&route.path) {
        entry.templates = Some(templates);
      } else {
        manifest.routes.insert(
          route.path.clone(),
          RouteManifestEntry {
            template: None,
            templates: Some(templates),
            layout: route.layout.clone(),
            loaders: route.loaders.clone(),
            head_meta: None,
            i18n_keys: route.i18n_keys.clone(),
          },
        );
      }
    } else {
      // i18n OFF: original behavior
      let axes = route.axes.as_ref().expect("axes required when i18n is off");
      let variants = route.variants.as_ref().expect("variants required when i18n is off");
      let mock_html = route.mock_html.as_ref().expect("mock_html required when i18n is off");

      let processed: Vec<_> = variants.iter().map(|v| sentinel_to_slots(&v.html)).collect();
      let template = extract_template(axes, &processed);

      ctr_check::verify_ctr_equivalence(&route.path, mock_html, &template, &route.mock)?;

      if let Some(schema) = &route.page_schema {
        for w in slot_warning::check_slot_types(&template, schema) {
          ui::detail(&format!("{YELLOW}warning{RESET}: {} {w}", route.path));
        }
      }

      let (document, head_meta) = if route.layout.is_some() {
        if dev_mode {
          (template.clone(), None)
        } else {
          let (meta, body) = extract_head_metadata(&template);
          let hm = if meta.is_empty() { None } else { Some(meta.to_string()) };
          (body.to_string(), hm)
        }
      } else {
        (wrap_document(&template, &assets.css, &assets.js, dev_mode, vite, root_id), None)
      };

      let filename = path_to_filename(&route.path);
      let filepath = templates_dir.join(&filename);
      std::fs::write(&filepath, &document)
        .with_context(|| format!("failed to write {}", filepath.display()))?;

      let size = document.len() as u64;
      let template_rel = format!("templates/{filename}");
      ui::detail_ok(&format!(
        "{}  \u{2192} {template_rel}  {DIM}({}){RESET}",
        route.path,
        ui::format_size(size)
      ));

      manifest.routes.insert(
        route.path.clone(),
        RouteManifestEntry {
          template: Some(template_rel),
          templates: None,
          layout: route.layout.clone(),
          loaders: route.loaders.clone(),
          head_meta,
          i18n_keys: route.i18n_keys.clone(),
        },
      );
    }
  }
  Ok(manifest)
}
