/* src/cli/core/src/build/route/i18n_resolve.rs */

use std::collections::BTreeMap;

use serde_json::Value;

use crate::ui::{self, RESET, YELLOW};

/// Resolve fallback chain so every locale has every key.
///
/// Algorithm per key per locale:
/// 1. Target locale has non-empty value -> use it
/// 2. Walk `locales` list in order (skip target), first non-empty wins
/// 3. All empty -> use key itself as value; emit CLI warning
pub(crate) fn resolve_fallback(
  messages: &BTreeMap<String, Value>,
  locales: &[String],
) -> BTreeMap<String, Value> {
  // Collect all known keys across all locales
  let mut all_keys = BTreeMap::<String, ()>::new();
  for data in messages.values() {
    if let Some(obj) = data.as_object() {
      for key in obj.keys() {
        all_keys.insert(key.clone(), ());
      }
    }
  }

  let mut resolved = BTreeMap::new();

  for locale in locales {
    let mut locale_msgs = serde_json::Map::new();

    for key in all_keys.keys() {
      let val = lookup_value(messages, locale, key, locales);
      match val {
        Some(v) => {
          locale_msgs.insert(key.clone(), v);
        }
        None => {
          ui::detail(&format!(
            "{YELLOW}warning{RESET}: i18n key \"{key}\" has no value in any locale, using key as fallback"
          ));
          locale_msgs.insert(key.clone(), Value::String(key.clone()));
        }
      }
    }

    resolved.insert(locale.clone(), Value::Object(locale_msgs));
  }

  resolved
}

/// Look up a value for (locale, key) with fallback walk.
fn lookup_value(
  messages: &BTreeMap<String, Value>,
  target_locale: &str,
  key: &str,
  locales: &[String],
) -> Option<Value> {
  // 1. Check target locale
  if let Some(val) = get_non_empty(messages, target_locale, key) {
    return Some(val);
  }
  // 2. Walk locales in order (skip target)
  for locale in locales {
    if locale == target_locale {
      continue;
    }
    if let Some(val) = get_non_empty(messages, locale, key) {
      return Some(val);
    }
  }
  // 3. No value found
  None
}

/// Get a value from messages[locale][key], returning None for missing or empty strings.
fn get_non_empty(messages: &BTreeMap<String, Value>, locale: &str, key: &str) -> Option<Value> {
  let data = messages.get(locale)?;
  let val = data.get(key)?;
  // Treat empty strings as missing
  if let Some(s) = val.as_str() {
    if s.is_empty() {
      return None;
    }
  }
  Some(val.clone())
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;

  fn make_messages(pairs: &[(&str, Value)]) -> BTreeMap<String, Value> {
    pairs.iter().map(|(k, v)| (k.to_string(), v.clone())).collect()
  }

  #[test]
  fn full_coverage() {
    let msgs = make_messages(&[
      ("en", json!({"hello": "Hello", "bye": "Bye"})),
      ("zh", json!({"hello": "你好", "bye": "再见"})),
    ]);
    let resolved = resolve_fallback(&msgs, &["en".into(), "zh".into()]);
    assert_eq!(resolved["en"]["hello"], "Hello");
    assert_eq!(resolved["zh"]["hello"], "你好");
  }

  #[test]
  fn fallback_to_other_locale() {
    let msgs = make_messages(&[
      ("en", json!({"hello": "Hello", "bye": "Bye"})),
      ("zh", json!({"hello": "你好"})),
    ]);
    let resolved = resolve_fallback(&msgs, &["en".into(), "zh".into()]);
    // zh missing "bye", should fallback to en
    assert_eq!(resolved["zh"]["bye"], "Bye");
    // en has both keys
    assert_eq!(resolved["en"]["bye"], "Bye");
  }

  #[test]
  fn fallback_to_key_itself() {
    let msgs = make_messages(&[
      ("en", json!({"hello": "Hello"})),
      ("zh", json!({"hello": "你好", "missing.key": ""})),
    ]);
    let locales = vec!["en".into(), "zh".into()];
    let resolved = resolve_fallback(&msgs, &locales);
    // "missing.key" has empty string in zh, no value in en -> falls back to key
    assert_eq!(resolved["en"]["missing.key"], "missing.key");
    assert_eq!(resolved["zh"]["missing.key"], "missing.key");
  }

  #[test]
  fn empty_string_treated_as_missing() {
    let msgs = make_messages(&[("en", json!({"hello": "Hello"})), ("zh", json!({"hello": ""}))]);
    let resolved = resolve_fallback(&msgs, &["en".into(), "zh".into()]);
    // zh has empty string -> should fallback to en
    assert_eq!(resolved["zh"]["hello"], "Hello");
  }

  #[test]
  fn three_locales_walk_order() {
    let msgs =
      make_messages(&[("en", json!({})), ("zh", json!({"greeting": "你好"})), ("ja", json!({}))]);
    let resolved = resolve_fallback(&msgs, &["en".into(), "zh".into(), "ja".into()]);
    // en and ja missing "greeting", should walk to zh
    assert_eq!(resolved["en"]["greeting"], "你好");
    assert_eq!(resolved["ja"]["greeting"], "你好");
  }
}
