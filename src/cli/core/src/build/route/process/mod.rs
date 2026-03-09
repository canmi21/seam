/* src/cli/core/src/build/route/process/mod.rs */

mod assets;
mod i18n_export;
mod skeleton;

pub(crate) use i18n_export::export_i18n;
pub(crate) use skeleton::run_skeleton_renderer;

use std::collections::BTreeMap;
use std::path::Path;

use anyhow::{Context, Result};

use super::helpers::path_to_filename;
use super::types::{
	I18nManifest, LayoutManifestEntry, RouteManifest, RouteManifestEntry, SkeletonLayout,
	SkeletonRoute,
};
use crate::build::types::{AssetFiles, BundleManifest, ViteDevInfo};
use crate::config::{I18nSection, OutputMode};
use crate::ui::{self, DIM, RESET, col};
use assets::compute_route_assets;
use seam_skeleton::{ctr_check, extract_template, sentinel_to_slots};
use seam_skeleton::{slot_warning, wrap_document};

/// Rendering parameters shared across layout and route processing.
pub(crate) struct RenderContext<'a> {
	pub root_id: &'a str,
	pub data_id: &'a str,
	pub dev_mode: bool,
	pub vite: Option<&'a ViteDevInfo>,
}

/// Optional per-page splitting context from the bundler.
pub(crate) struct BundleContext<'a> {
	pub manifest: Option<&'a BundleManifest>,
	pub source_file_map: Option<&'a BTreeMap<String, String>>,
}

/// Internal routing context shared between i18n and single-route processing.
struct RouteProcessCtx<'a> {
	templates_dir: &'a Path,
	assets: &'a AssetFiles,
	render: &'a RenderContext<'a>,
	i18n: Option<&'a I18nSection>,
	bundle: &'a BundleContext<'a>,
}

pub(crate) fn process_routes(
	layouts: &[SkeletonLayout],
	routes: &[SkeletonRoute],
	templates_dir: &Path,
	assets: &AssetFiles,
	render: &RenderContext<'_>,
	i18n: Option<&I18nSection>,
	bundle: &BundleContext<'_>,
) -> Result<RouteManifest> {
	let manifest_data_id =
		if render.data_id == "__data" { None } else { Some(render.data_id.to_string()) };
	let i18n_manifest = i18n.map(|cfg| I18nManifest {
		locales: cfg.locales.clone(),
		default: cfg.default.clone(),
		mode: cfg.mode.as_str().to_string(),
		cache: cfg.cache,
		route_hashes: BTreeMap::new(),
		content_hashes: BTreeMap::new(),
	});
	let mut manifest = RouteManifest {
		layouts: BTreeMap::new(),
		routes: BTreeMap::new(),
		data_id: manifest_data_id,
		i18n: i18n_manifest,
	};

	process_layout_templates(layouts, templates_dir, assets, render, &mut manifest)?;

	let ctx = RouteProcessCtx { templates_dir, assets, render, i18n, bundle };
	for route in routes {
		if let Some(ref locale_variants) = route.locale_variants {
			process_i18n_route(route, locale_variants, &ctx, &mut manifest)?;
		} else {
			process_single_route(route, &ctx, &mut manifest)?;
		}
	}
	Ok(manifest)
}

// -- Layout processing --

fn process_layout_templates(
	layouts: &[SkeletonLayout],
	templates_dir: &Path,
	assets: &AssetFiles,
	render: &RenderContext<'_>,
	manifest: &mut RouteManifest,
) -> Result<()> {
	for layout in layouts {
		let is_root = layout.parent.is_none();
		if let Some(ref locale_html) = layout.locale_html {
			let mut templates = BTreeMap::new();
			for (locale, html) in locale_html {
				let html = html.replace("<seam-outlet></seam-outlet>", "<!--seam:outlet-->");
				let html = sentinel_to_slots(&html);
				let document = if is_root {
					wrap_document(
						&html,
						&assets.css,
						&assets.js,
						render.dev_mode,
						render.vite,
						render.root_id,
					)
				} else {
					html
				};
				let locale_dir = templates_dir.join(locale);
				std::fs::create_dir_all(&locale_dir)
					.with_context(|| format!("failed to create {}", locale_dir.display()))?;
				let filename = format!("{}.html", layout.id);
				let filepath = locale_dir.join(&filename);
				std::fs::write(&filepath, &document)
					.with_context(|| format!("failed to write {}", filepath.display()))?;
				templates.insert(locale.clone(), format!("templates/{locale}/{filename}"));
			}
			ui::detail_ok(&format!(
				"layout {} {}-> {} locales{}",
				layout.id,
				col(DIM),
				locale_html.len(),
				col(RESET)
			));
			manifest.layouts.insert(
				layout.id.clone(),
				LayoutManifestEntry {
					template: None,
					templates: Some(templates),
					loaders: layout.loaders.clone(),
					parent: layout.parent.clone(),
					i18n_keys: layout.i18n_keys.clone(),
					projections: None,
				},
			);
		} else if let Some(ref html) = layout.html {
			let html = html.replace("<seam-outlet></seam-outlet>", "<!--seam:outlet-->");
			let html = sentinel_to_slots(&html);
			let document = if is_root {
				wrap_document(&html, &assets.css, &assets.js, render.dev_mode, render.vite, render.root_id)
			} else {
				html
			};
			let filename = format!("{}.html", layout.id);
			let filepath = templates_dir.join(&filename);
			std::fs::write(&filepath, &document)
				.with_context(|| format!("failed to write {}", filepath.display()))?;
			let template_rel = format!("templates/{filename}");
			ui::detail_ok(&format!("layout {} {}-> {template_rel}{}", layout.id, col(DIM), col(RESET)));
			manifest.layouts.insert(
				layout.id.clone(),
				LayoutManifestEntry {
					template: Some(template_rel),
					templates: None,
					loaders: layout.loaders.clone(),
					parent: layout.parent.clone(),
					i18n_keys: layout.i18n_keys.clone(),
					projections: None,
				},
			);
		}
	}
	Ok(())
}

// -- Route document rendering --

/// Render a route template into a final document. For routes with layouts,
/// returns the template as-is (head_meta now comes from skeleton output).
/// For standalone routes, wraps with full HTML document structure.
fn render_route_document(
	template: &str,
	has_layout: bool,
	assets: &AssetFiles,
	render: &RenderContext<'_>,
) -> String {
	if has_layout {
		template.to_string()
	} else {
		wrap_document(template, &assets.css, &assets.js, render.dev_mode, render.vite, render.root_id)
	}
}

// -- i18n route processing --

fn process_i18n_route(
	route: &SkeletonRoute,
	locale_variants: &BTreeMap<String, super::types::LocaleRouteData>,
	ctx: &RouteProcessCtx<'_>,
	manifest: &mut RouteManifest,
) -> Result<()> {
	let mut templates = BTreeMap::new();
	for (locale, data) in locale_variants {
		let processed: Vec<_> = data.variants.iter().map(|v| sentinel_to_slots(&v.html)).collect();
		let template = extract_template(&data.axes, &processed);

		ctr_check::verify_ctr_equivalence(
			&route.path,
			&data.mock_html,
			&template,
			&route.mock,
			ctx.render.data_id,
		)?;

		if let Some(schema) = &route.page_schema {
			for w in slot_warning::check_slot_types(&template, schema) {
				ui::detail_warn(&format!("{} [{locale}] {w}", route.path));
			}
		}

		let document = render_route_document(&template, route.layout.is_some(), ctx.assets, ctx.render);

		let locale_dir = ctx.templates_dir.join(locale);
		std::fs::create_dir_all(&locale_dir)
			.with_context(|| format!("failed to create {}", locale_dir.display()))?;
		let filename = path_to_filename(&route.path);
		let filepath = locale_dir.join(&filename);
		std::fs::write(&filepath, &document)
			.with_context(|| format!("failed to write {}", filepath.display()))?;

		templates.insert(locale.clone(), format!("templates/{locale}/{filename}"));

		// Store head_meta from the default locale only
		if ctx.i18n.is_some_and(|cfg| locale == &cfg.default) {
			let route_assets =
				compute_route_assets(&route.path, ctx.bundle.source_file_map, ctx.bundle.manifest);
			manifest.routes.entry(route.path.clone()).or_insert_with(|| RouteManifestEntry {
				template: None,
				templates: None,
				layout: route.layout.clone(),
				loaders: route.loaders.clone(),
				head_meta: route.head_meta.clone(),
				i18n_keys: route.i18n_keys.clone(),
				assets: route_assets,
				procedures: None,
				projections: None,
				prerender: route.prerender,
			});
		}
	}

	let size = locale_variants.values().next().map(|d| d.mock_html.len() as u64).unwrap_or(0);
	ui::detail_ok(&format!(
		"{}  {}\u{2192} {} locales  (~{}){}",
		route.path,
		col(DIM),
		locale_variants.len(),
		ui::format_size(size),
		col(RESET)
	));

	if let Some(entry) = manifest.routes.get_mut(&route.path) {
		entry.templates = Some(templates);
	} else {
		let route_assets =
			compute_route_assets(&route.path, ctx.bundle.source_file_map, ctx.bundle.manifest);
		manifest.routes.insert(
			route.path.clone(),
			RouteManifestEntry {
				template: None,
				templates: Some(templates),
				layout: route.layout.clone(),
				loaders: route.loaders.clone(),
				head_meta: None,
				i18n_keys: route.i18n_keys.clone(),
				assets: route_assets,
				procedures: None,
				projections: None,
				prerender: route.prerender,
			},
		);
	}
	Ok(())
}

// -- Single (non-i18n) route processing --

fn process_single_route(
	route: &SkeletonRoute,
	ctx: &RouteProcessCtx<'_>,
	manifest: &mut RouteManifest,
) -> Result<()> {
	let axes = route.axes.as_ref().expect("axes required when i18n is off");
	let variants = route.variants.as_ref().expect("variants required when i18n is off");
	let mock_html = route.mock_html.as_ref().expect("mock_html required when i18n is off");

	let processed: Vec<_> = variants.iter().map(|v| sentinel_to_slots(&v.html)).collect();
	let template = extract_template(axes, &processed);

	ctr_check::verify_ctr_equivalence(
		&route.path,
		mock_html,
		&template,
		&route.mock,
		ctx.render.data_id,
	)?;

	if let Some(schema) = &route.page_schema {
		for w in slot_warning::check_slot_types(&template, schema) {
			ui::detail_warn(&format!("{} {w}", route.path));
		}
	}

	let document = render_route_document(&template, route.layout.is_some(), ctx.assets, ctx.render);

	let filename = path_to_filename(&route.path);
	let filepath = ctx.templates_dir.join(&filename);
	std::fs::write(&filepath, &document)
		.with_context(|| format!("failed to write {}", filepath.display()))?;

	let size = document.len() as u64;
	let template_rel = format!("templates/{filename}");
	ui::detail_ok(&format!(
		"{}  {}\u{2192} {template_rel}  ({}){}",
		route.path,
		col(DIM),
		ui::format_size(size),
		col(RESET)
	));

	let route_assets =
		compute_route_assets(&route.path, ctx.bundle.source_file_map, ctx.bundle.manifest);
	manifest.routes.insert(
		route.path.clone(),
		RouteManifestEntry {
			template: Some(template_rel),
			templates: None,
			layout: route.layout.clone(),
			loaders: route.loaders.clone(),
			head_meta: route.head_meta.clone(),
			i18n_keys: route.i18n_keys.clone(),
			assets: route_assets,
			procedures: None,
			projections: None,
			prerender: route.prerender,
		},
	);
	Ok(())
}

/// Apply output mode behavior matrix to route manifest entries.
///
/// | output  | no prerender | prerender=true | prerender=false |
/// |---------|--------------|----------------|-----------------|
/// | static  | SSG          | SSG            | warn, still SSG |
/// | server  | CTR          | warn, still CTR| CTR             |
/// | hybrid  | CTR          | SSG            | CTR             |
pub(crate) fn apply_output_mode(manifest: &mut RouteManifest, output: OutputMode) {
	for (path, entry) in &mut manifest.routes {
		let explicit = entry.prerender;
		let effective = match output {
			OutputMode::Static => {
				if explicit == Some(false) {
					ui::detail_warn(&format!(
						"{path}: prerender=false ignored in static mode (all pages are SSG)"
					));
				}
				Some(true)
			}
			OutputMode::Server => {
				if explicit == Some(true) {
					ui::detail_warn(&format!(
						"{path}: prerender=true ignored in server mode (all pages are CTR)"
					));
				}
				None
			}
			OutputMode::Hybrid => explicit,
		};
		entry.prerender = effective;
	}
}
