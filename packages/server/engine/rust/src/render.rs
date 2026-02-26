/* packages/server/engine/rust/src/render.rs */

use crate::escape::ascii_escape_json;
use crate::page::{
  build_seam_data, flatten_for_slots, inject_data_script, inject_head_meta, inject_html_lang,
  I18nOpts, PageConfig,
};

/// Render a page: inject data into template, assemble `__SEAM_DATA__` script,
/// apply head metadata and locale attributes.
///
/// This is the single entry point that replaces ~60 lines of duplicated logic
/// across TS, Rust, and Go backends.
///
/// Arguments are JSON strings for cross-language compatibility:
/// - `template`: pre-resolved HTML template (layout chain already applied)
/// - `loader_data_json`: `{"key": value, ...}` from all loaders (layout + page)
/// - `config_json`: serialized `PageConfig`
/// - `i18n_opts_json`: optional serialized `I18nOpts`
pub fn render_page(
  template: &str,
  loader_data_json: &str,
  config_json: &str,
  i18n_opts_json: Option<&str>,
) -> String {
  let loader_data: serde_json::Value =
    serde_json::from_str(loader_data_json).unwrap_or(serde_json::Value::Null);
  let config: PageConfig = match serde_json::from_str(config_json) {
    Ok(c) => c,
    Err(_) => return template.to_string(),
  };
  let i18n_opts: Option<I18nOpts> = i18n_opts_json.and_then(|s| serde_json::from_str(s).ok());

  // Step 1: Flatten loader data for slot resolution
  let flat_data = flatten_for_slots(&loader_data);

  // Step 2: Inject slots into template (no data script)
  let mut html = seam_injector::inject_no_script(template, &flat_data);

  // Step 3: Inject page-level head metadata
  if let Some(ref meta) = config.head_meta {
    // Inject the head_meta with slot data resolved
    let injected_meta = seam_injector::inject_no_script(meta, &flat_data);
    html = inject_head_meta(&html, &injected_meta);
  }

  // Step 4: Set <html lang="..."> when locale is known
  if let Some(ref opts) = i18n_opts {
    html = inject_html_lang(&html, &opts.locale);
  }

  // Step 5: Build __SEAM_DATA__ JSON and inject script
  let seam_data = build_seam_data(&loader_data, &config, i18n_opts.as_ref());
  let json = serde_json::to_string(&seam_data).unwrap_or_default();
  let escaped = ascii_escape_json(&json);
  inject_data_script(&html, &config.data_id, &escaped)
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;

  fn simple_template() -> String {
    r#"<html><head><meta charset="utf-8"><title>Test</title></head><body><p><!--seam:title--></p></body></html>"#.to_string()
  }

  #[test]
  fn render_basic_page() {
    let template = simple_template();
    let data = json!({"title": "Hello"}).to_string();
    let config = json!({"layout_chain": [], "data_id": "__SEAM_DATA__"}).to_string();

    let result = render_page(&template, &data, &config, None);
    assert!(result.contains("<p>Hello</p>"));
    assert!(result.contains(r#"<script id="__SEAM_DATA__""#));
    assert!(result.contains(r#""title":"Hello""#));
  }

  #[test]
  fn render_with_layout() {
    let template = simple_template();
    let data = json!({"title": "Page", "nav": "NavData"}).to_string();
    let config = json!({
      "layout_chain": [{"id": "root", "loader_keys": ["nav"]}],
      "data_id": "__SEAM_DATA__"
    })
    .to_string();

    let result = render_page(&template, &data, &config, None);
    // nav should be under _layouts.root, not at top level
    assert!(result.contains(r#""_layouts""#), "missing _layouts key");
    assert!(result.contains(r#""root""#), "missing root layout key");
    // Page data should be at top level
    assert!(result.contains(r#""title":"Page""#), "missing page-level title");
  }

  #[test]
  fn render_with_i18n() {
    let template = simple_template();
    let data = json!({"title": "Hello"}).to_string();
    let config = json!({"layout_chain": [], "data_id": "__SEAM_DATA__"}).to_string();
    let i18n = json!({
      "locale": "zh",
      "default_locale": "en",
      "messages": {"hello": "你好"}
    })
    .to_string();

    let result = render_page(&template, &data, &config, Some(&i18n));
    assert!(result.contains(r#"<html lang="zh""#));
    assert!(result.contains(r#""_i18n""#));
  }

  #[test]
  fn render_with_head_meta() {
    let template = simple_template();
    let data = json!({"title": "Hello"}).to_string();
    let config = json!({
      "layout_chain": [],
      "data_id": "__SEAM_DATA__",
      "head_meta": r#"<title><!--seam:title--></title>"#
    })
    .to_string();

    let result = render_page(&template, &data, &config, None);
    // head_meta should be injected after <meta charset="utf-8">
    assert!(result.contains(r#"<meta charset="utf-8"><title>Hello</title>"#));
  }

  #[test]
  fn render_invalid_config_returns_template() {
    let template = "plain html";
    let result = render_page(template, "{}", "invalid json", None);
    assert_eq!(result, "plain html");
  }
}
