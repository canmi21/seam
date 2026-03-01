/* packages/server/engine/rust/src/page.rs */

use serde::{Deserialize, Serialize};

/// One entry in a layout chain (outer to inner order).
/// Each layout owns a set of loader data keys.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayoutChainEntry {
  pub id: String,
  pub loader_keys: Vec<String>,
}

/// Configuration for page assembly, passed as JSON.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PageConfig {
  pub layout_chain: Vec<LayoutChainEntry>,
  pub data_id: String,
  #[serde(default)]
  pub head_meta: Option<String>,
}

/// i18n options for page rendering, passed as JSON.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct I18nOpts {
  pub locale: String,
  pub default_locale: String,
  pub messages: serde_json::Value,
  /// Content hash (4 hex) for cache validation
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub hash: Option<String>,
  /// Full route→locale→hash table for client cache layer
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub router: Option<serde_json::Value>,
}

/// Flatten keyed loader results for slot resolution: spread nested object
/// values to the top level so slots like `<!--seam:tagline-->` can resolve from
/// data like `{page: {tagline: "..."}}`.
pub fn flatten_for_slots(keyed: &serde_json::Value) -> serde_json::Value {
  let Some(obj) = keyed.as_object() else {
    return keyed.clone();
  };
  let mut merged = obj.clone();
  for value in obj.values() {
    if let serde_json::Value::Object(nested) = value {
      for (nk, nv) in nested {
        merged.entry(nk.clone()).or_insert_with(|| nv.clone());
      }
    }
  }
  serde_json::Value::Object(merged)
}

/// Build the data script JSON object with correct per-layout `_layouts` grouping.
///
/// Unlike the old single-layout-id approach, this groups data under each layout
/// in the chain independently, matching the TS reference implementation.
pub fn build_seam_data(
  loader_data: &serde_json::Value,
  config: &PageConfig,
  i18n_opts: Option<&I18nOpts>,
) -> serde_json::Value {
  let Some(data_obj) = loader_data.as_object() else {
    return loader_data.clone();
  };

  if config.layout_chain.is_empty() {
    // No layouts: all data at top level
    let mut result = data_obj.clone();
    inject_i18n_data(&mut result, i18n_opts);
    return serde_json::Value::Object(result);
  }

  // Collect all layout-claimed keys
  let mut claimed_keys = std::collections::HashSet::new();
  for entry in &config.layout_chain {
    for key in &entry.loader_keys {
      claimed_keys.insert(key.as_str());
    }
  }

  // Page data = keys not claimed by any layout
  let mut script_data = serde_json::Map::new();
  for (k, v) in data_obj {
    if !claimed_keys.contains(k.as_str()) {
      script_data.insert(k.clone(), v.clone());
    }
  }

  // Build per-layout _layouts grouping
  let mut layouts_map = serde_json::Map::new();
  for entry in &config.layout_chain {
    let mut layout_data = serde_json::Map::new();
    for key in &entry.loader_keys {
      if let Some(v) = data_obj.get(key) {
        layout_data.insert(key.clone(), v.clone());
      }
    }
    if !layout_data.is_empty() {
      layouts_map.insert(entry.id.clone(), serde_json::Value::Object(layout_data));
    }
  }
  if !layouts_map.is_empty() {
    script_data.insert("_layouts".to_string(), serde_json::Value::Object(layouts_map));
  }

  inject_i18n_data(&mut script_data, i18n_opts);
  serde_json::Value::Object(script_data)
}

/// Inject `_i18n` data into the script data map for client hydration.
fn inject_i18n_data(
  script_data: &mut serde_json::Map<String, serde_json::Value>,
  i18n_opts: Option<&I18nOpts>,
) {
  let Some(opts) = i18n_opts else { return };

  let mut i18n_data = serde_json::Map::new();
  i18n_data.insert("locale".into(), serde_json::Value::String(opts.locale.clone()));
  i18n_data.insert("messages".into(), opts.messages.clone());
  if let Some(ref h) = opts.hash {
    i18n_data.insert("hash".into(), serde_json::Value::String(h.clone()));
  }
  if let Some(ref r) = opts.router {
    i18n_data.insert("router".into(), r.clone());
  }

  script_data.insert("_i18n".into(), serde_json::Value::Object(i18n_data));
}

/// Filter i18n messages to only include keys in the allow list.
/// Empty list means include all messages.
pub fn filter_i18n_messages(messages: &serde_json::Value, keys: &[String]) -> serde_json::Value {
  if keys.is_empty() {
    return messages.clone();
  }
  let Some(obj) = messages.as_object() else {
    return messages.clone();
  };
  let filtered: serde_json::Map<String, serde_json::Value> =
    keys.iter().filter_map(|k| obj.get(k).map(|v| (k.clone(), v.clone()))).collect();
  serde_json::Value::Object(filtered)
}

/// Inject a `<script>` tag with JSON data before `</body>`.
pub fn inject_data_script(html: &str, data_id: &str, json: &str) -> String {
  let script = format!(r#"<script id="{data_id}" type="application/json">{json}</script>"#);
  if let Some(pos) = html.rfind("</body>") {
    let mut result = String::with_capacity(html.len() + script.len());
    result.push_str(&html[..pos]);
    result.push_str(&script);
    result.push_str(&html[pos..]);
    result
  } else {
    format!("{html}{script}")
  }
}

/// Set `<html lang="...">` attribute.
pub fn inject_html_lang(html: &str, locale: &str) -> String {
  html.replacen("<html", &format!("<html lang=\"{locale}\""), 1)
}

/// Inject page-level head metadata after `<meta charset="utf-8">`.
pub fn inject_head_meta(html: &str, meta_html: &str) -> String {
  let charset = r#"<meta charset="utf-8">"#;
  if let Some(pos) = html.find(charset) {
    let insert_at = pos + charset.len();
    let mut result = String::with_capacity(html.len() + meta_html.len());
    result.push_str(&html[..insert_at]);
    result.push_str(meta_html);
    result.push_str(&html[insert_at..]);
    result
  } else {
    html.to_string()
  }
}

/// Process an i18n query: look up requested keys from locale messages,
/// with per-key fallback to default locale, then key itself.
pub fn i18n_query(
  keys: &[String],
  locale: &str,
  default_locale: &str,
  all_messages: &serde_json::Value,
) -> serde_json::Value {
  let empty = serde_json::Value::Object(Default::default());
  let target_msgs = all_messages.get(locale).unwrap_or(&empty);
  let default_msgs = all_messages.get(default_locale).unwrap_or(&empty);

  let mut messages = serde_json::Map::new();
  for key in keys {
    let val = target_msgs
      .get(key)
      .or_else(|| default_msgs.get(key))
      .and_then(|v| v.as_str())
      .unwrap_or(key)
      .to_string();
    messages.insert(key.clone(), serde_json::Value::String(val));
  }
  serde_json::json!({ "messages": messages })
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;

  #[test]
  fn flatten_spreads_nested() {
    let input = json!({"page": {"title": "Hello", "tagline": "World"}, "other": 42});
    let flat = flatten_for_slots(&input);
    assert_eq!(flat["title"], "Hello");
    assert_eq!(flat["tagline"], "World");
    assert_eq!(flat["other"], 42);
    assert_eq!(flat["page"]["title"], "Hello");
  }

  #[test]
  fn flatten_no_override() {
    // Top-level keys should not be overridden by nested ones
    let input = json!({"title": "Top", "page": {"title": "Nested"}});
    let flat = flatten_for_slots(&input);
    assert_eq!(flat["title"], "Top");
  }

  #[test]
  fn build_seam_data_no_layout() {
    let data = json!({"title": "Hello", "count": 42});
    let config = PageConfig { layout_chain: vec![], data_id: "__data".into(), head_meta: None };
    let result = build_seam_data(&data, &config, None);
    assert_eq!(result["title"], "Hello");
    assert_eq!(result["count"], 42);
    assert!(result.get("_layouts").is_none());
  }

  #[test]
  fn build_seam_data_single_layout() {
    let data = json!({"pageKey": "page_val", "layoutKey": "layout_val"});
    let config = PageConfig {
      layout_chain: vec![LayoutChainEntry {
        id: "root".into(),
        loader_keys: vec!["layoutKey".into()],
      }],
      data_id: "__data".into(),
      head_meta: None,
    };
    let result = build_seam_data(&data, &config, None);
    assert_eq!(result["pageKey"], "page_val");
    assert_eq!(result["_layouts"]["root"]["layoutKey"], "layout_val");
    assert!(result.get("layoutKey").is_none());
  }

  #[test]
  fn build_seam_data_multi_layout() {
    // Two layouts: outer claims "nav", inner claims "sidebar"
    let data = json!({"page_data": "p", "nav": "n", "sidebar": "s"});
    let config = PageConfig {
      layout_chain: vec![
        LayoutChainEntry { id: "outer".into(), loader_keys: vec!["nav".into()] },
        LayoutChainEntry { id: "inner".into(), loader_keys: vec!["sidebar".into()] },
      ],
      data_id: "__data".into(),
      head_meta: None,
    };
    let result = build_seam_data(&data, &config, None);
    assert_eq!(result["page_data"], "p");
    assert_eq!(result["_layouts"]["outer"]["nav"], "n");
    assert_eq!(result["_layouts"]["inner"]["sidebar"], "s");
    // Page-level should not have layout keys
    assert!(result.get("nav").is_none());
    assert!(result.get("sidebar").is_none());
  }

  #[test]
  fn build_seam_data_with_i18n() {
    let data = json!({"title": "Hello"});
    let config = PageConfig { layout_chain: vec![], data_id: "__data".into(), head_meta: None };
    let i18n = I18nOpts {
      locale: "zh".into(),
      default_locale: "en".into(),
      messages: json!({"hello": "你好"}),
      hash: None,
      router: None,
    };
    let result = build_seam_data(&data, &config, Some(&i18n));
    assert_eq!(result["_i18n"]["locale"], "zh");
    assert_eq!(result["_i18n"]["messages"]["hello"], "你好");
    assert!(result["_i18n"].get("hash").is_none());
    assert!(result["_i18n"].get("router").is_none());
  }

  #[test]
  fn filter_messages_all() {
    let msgs = json!({"hello": "Hello", "bye": "Bye"});
    let filtered = filter_i18n_messages(&msgs, &[]);
    assert_eq!(filtered, msgs);
  }

  #[test]
  fn filter_messages_subset() {
    let msgs = json!({"hello": "Hello", "bye": "Bye", "ok": "OK"});
    let filtered = filter_i18n_messages(&msgs, &["hello".into(), "ok".into()]);
    assert_eq!(filtered, json!({"hello": "Hello", "ok": "OK"}));
  }

  #[test]
  fn inject_data_script_before_body() {
    let html = "<html><body><p>Content</p></body></html>";
    let result = inject_data_script(html, "__data", r#"{"a":1}"#);
    assert!(
      result.contains(r#"<script id="__data" type="application/json">{"a":1}</script></body>"#)
    );
  }

  #[test]
  fn inject_data_script_no_body() {
    let html = "<html><p>Content</p></html>";
    let result = inject_data_script(html, "__data", r#"{"a":1}"#);
    assert!(result.ends_with(r#"<script id="__data" type="application/json">{"a":1}</script>"#));
  }

  #[test]
  fn inject_html_lang_test() {
    let html = "<html><head></head></html>";
    let result = inject_html_lang(html, "zh");
    assert!(result.starts_with(r#"<html lang="zh""#));
  }

  #[test]
  fn inject_head_meta_test() {
    let html = r#"<html><head><meta charset="utf-8"><title>Test</title></head></html>"#;
    let result = inject_head_meta(html, r#"<meta name="desc" content="x">"#);
    assert!(result.contains(r#"<meta charset="utf-8"><meta name="desc" content="x"><title>"#));
  }

  #[test]
  fn i18n_query_basic() {
    let msgs = json!({"en": {"hello": "Hello", "bye": "Bye"}, "zh": {"hello": "你好"}});
    let result = i18n_query(&["hello".into(), "bye".into()], "zh", "en", &msgs);
    assert_eq!(result["messages"]["hello"], "你好");
    // "bye" not in zh, falls back to default locale (en)
    assert_eq!(result["messages"]["bye"], "Bye");
  }

  #[test]
  fn i18n_query_fallback_to_default() {
    let msgs = json!({"en": {"hello": "Hello"}, "zh": {}});
    let result = i18n_query(&["hello".into()], "fr", "en", &msgs);
    assert_eq!(result["messages"]["hello"], "Hello");
  }
}
