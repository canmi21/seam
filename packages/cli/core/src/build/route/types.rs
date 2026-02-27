/* packages/cli/core/src/build/route/types.rs */

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use super::super::skeleton::Axis;

// -- Node script output types --

#[derive(Deserialize)]
pub(crate) struct SkeletonLayout {
  pub(crate) id: String,
  // i18n OFF: single html
  #[serde(default)]
  pub(crate) html: Option<String>,
  // i18n ON: per-locale html
  #[serde(rename = "localeHtml", default)]
  pub(crate) locale_html: Option<BTreeMap<String, String>>,
  #[serde(default)]
  pub(crate) loaders: serde_json::Value,
  #[serde(rename = "i18nKeys", default)]
  pub(crate) i18n_keys: Option<Vec<String>>,
  pub(crate) parent: Option<String>,
}

#[derive(Deserialize)]
pub(crate) struct CacheStats {
  pub(crate) hits: u32,
  pub(crate) misses: u32,
}

#[derive(Deserialize)]
pub(crate) struct SkeletonOutput {
  #[serde(default)]
  pub(crate) layouts: Vec<SkeletonLayout>,
  pub(crate) routes: Vec<SkeletonRoute>,
  #[serde(default)]
  pub(crate) warnings: Vec<String>,
  #[serde(rename = "cacheStats", default)]
  pub(crate) cache: Option<CacheStats>,
}

#[derive(Deserialize)]
pub(crate) struct SkeletonRoute {
  pub(super) path: String,
  pub(super) loaders: serde_json::Value,
  // i18n OFF: flat fields (backward compatible)
  #[serde(default)]
  pub(super) axes: Option<Vec<Axis>>,
  #[serde(default)]
  pub(super) variants: Option<Vec<RenderedVariant>>,
  #[serde(rename = "mockHtml", default)]
  pub(super) mock_html: Option<String>,
  // i18n ON: per-locale data
  #[serde(rename = "localeVariants", default)]
  pub(super) locale_variants: Option<BTreeMap<String, LocaleRouteData>>,
  pub(super) mock: serde_json::Value,
  #[serde(rename = "pageSchema")]
  pub(super) page_schema: Option<serde_json::Value>,
  #[serde(default)]
  pub(super) layout: Option<String>,
  #[serde(rename = "i18nKeys", default)]
  pub(super) i18n_keys: Option<Vec<String>>,
}

#[derive(Deserialize)]
pub(super) struct LocaleRouteData {
  pub(super) axes: Vec<Axis>,
  pub(super) variants: Vec<RenderedVariant>,
  #[serde(rename = "mockHtml")]
  pub(super) mock_html: String,
}

#[derive(Deserialize)]
pub(super) struct RenderedVariant {
  #[serde(rename = "variant")]
  pub(super) _variant: serde_json::Value,
  pub(super) html: String,
}

// -- Route manifest output --

#[derive(Serialize)]
pub(super) struct LayoutManifestEntry {
  #[serde(skip_serializing_if = "Option::is_none")]
  pub(super) template: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub(super) templates: Option<BTreeMap<String, String>>,
  #[serde(skip_serializing_if = "serde_json::Value::is_null")]
  pub(super) loaders: serde_json::Value,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub(super) parent: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub(super) i18n_keys: Option<Vec<String>>,
}

#[derive(Serialize)]
pub(crate) struct RouteManifest {
  #[serde(skip_serializing_if = "BTreeMap::is_empty")]
  pub(super) layouts: BTreeMap<String, LayoutManifestEntry>,
  pub(super) routes: BTreeMap<String, RouteManifestEntry>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub(super) data_id: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub(super) i18n: Option<I18nManifest>,
}

#[derive(Serialize)]
pub(super) struct I18nManifest {
  pub(super) locales: Vec<String>,
  pub(super) default: String,
  pub(super) mode: String,
  #[serde(skip_serializing_if = "std::ops::Not::not")]
  pub(super) cache: bool,
  #[serde(skip_serializing_if = "BTreeMap::is_empty")]
  pub(super) route_hashes: BTreeMap<String, String>,
  #[serde(skip_serializing_if = "BTreeMap::is_empty")]
  pub(super) content_hashes: BTreeMap<String, BTreeMap<String, String>>,
}

#[derive(Serialize)]
pub(super) struct RouteManifestEntry {
  #[serde(skip_serializing_if = "Option::is_none")]
  pub(super) template: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub(super) templates: Option<BTreeMap<String, String>>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub(super) layout: Option<String>,
  pub(super) loaders: serde_json::Value,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub(super) head_meta: Option<String>,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub(super) i18n_keys: Option<Vec<String>>,
}
