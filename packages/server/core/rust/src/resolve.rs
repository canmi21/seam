/* packages/server/core/rust/src/resolve.rs */

use std::collections::HashSet;
use std::sync::Arc;

pub struct ResolveContext {
  pub path_locale: Option<String>,
  pub cookie_header: Option<String>,
  pub accept_language: Option<String>,
  pub locales: Vec<String>,
  pub default_locale: String,
}

pub type ResolveLocaleFn = Arc<dyn Fn(&ResolveContext) -> String + Send + Sync>;

/// Default resolve chain: path_locale -> cookie("seam-locale") -> Accept-Language -> default_locale
pub fn default_resolve(ctx: &ResolveContext) -> String {
  if let Some(ref loc) = ctx.path_locale {
    return loc.clone();
  }

  let locale_set: HashSet<&str> = ctx.locales.iter().map(|s| s.as_str()).collect();

  if let Some(ref header) = ctx.cookie_header {
    if let Some(loc) = parse_cookie_locale(header, "seam-locale", &locale_set) {
      return loc;
    }
  }

  if let Some(ref header) = ctx.accept_language {
    if let Some(loc) = parse_accept_language(header, &locale_set) {
      return loc;
    }
  }

  ctx.default_locale.clone()
}

fn parse_cookie_locale(header: &str, name: &str, locale_set: &HashSet<&str>) -> Option<String> {
  for pair in header.split(';') {
    let pair = pair.trim();
    if let Some((k, v)) = pair.split_once('=') {
      if k.trim() == name {
        let v = v.trim();
        if locale_set.contains(v) {
          return Some(v.to_string());
        }
      }
    }
  }
  None
}

fn parse_accept_language(header: &str, locale_set: &HashSet<&str>) -> Option<String> {
  if header.is_empty() {
    return None;
  }

  let mut entries: Vec<(&str, f64)> = Vec::new();
  for part in header.split(',') {
    let part = part.trim();
    if part.is_empty() {
      continue;
    }
    let mut segments = part.split(';');
    let lang = segments.next().unwrap_or("").trim();
    let mut q = 1.0_f64;
    for s in segments {
      let s = s.trim();
      if let Some(val) = s.strip_prefix("q=") {
        if let Ok(v) = val.parse::<f64>() {
          q = v;
        }
      }
    }
    entries.push((lang, q));
  }

  entries.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

  for (lang, _) in &entries {
    if locale_set.contains(lang) {
      return Some(lang.to_string());
    }
    // Prefix match: zh-CN -> zh
    if let Some(idx) = lang.find('-') {
      let prefix = &lang[..idx];
      if locale_set.contains(prefix) {
        return Some(prefix.to_string());
      }
    }
  }

  None
}

#[cfg(test)]
mod tests {
  use super::*;

  fn ctx(
    path_locale: Option<&str>,
    cookie: Option<&str>,
    accept_language: Option<&str>,
  ) -> ResolveContext {
    ResolveContext {
      path_locale: path_locale.map(String::from),
      cookie_header: cookie.map(String::from),
      accept_language: accept_language.map(String::from),
      locales: vec!["en".into(), "zh".into(), "ja".into()],
      default_locale: "en".into(),
    }
  }

  #[test]
  fn path_locale_wins() {
    assert_eq!(default_resolve(&ctx(Some("zh"), None, None)), "zh");
  }

  #[test]
  fn path_locale_beats_cookie() {
    assert_eq!(default_resolve(&ctx(Some("zh"), Some("seam-locale=ja"), None)), "zh");
  }

  #[test]
  fn cookie_resolves() {
    assert_eq!(default_resolve(&ctx(None, Some("seam-locale=ja"), None)), "ja");
  }

  #[test]
  fn cookie_beats_accept_language() {
    assert_eq!(default_resolve(&ctx(None, Some("seam-locale=ja"), Some("zh"))), "ja");
  }

  #[test]
  fn accept_language_resolves() {
    assert_eq!(default_resolve(&ctx(None, None, Some("zh,en;q=0.5"))), "zh");
  }

  #[test]
  fn accept_language_q_value_priority() {
    assert_eq!(default_resolve(&ctx(None, None, Some("en;q=0.5,zh;q=0.9"))), "zh");
  }

  #[test]
  fn accept_language_prefix_match() {
    assert_eq!(default_resolve(&ctx(None, None, Some("zh-CN,en;q=0.5"))), "zh");
  }

  #[test]
  fn unknown_cookie_falls_through() {
    assert_eq!(default_resolve(&ctx(None, Some("seam-locale=fr"), None)), "en");
  }

  #[test]
  fn falls_back_to_default() {
    assert_eq!(default_resolve(&ctx(None, None, None)), "en");
  }

  #[test]
  fn cookie_with_multiple_pairs() {
    assert_eq!(default_resolve(&ctx(None, Some("other=1; seam-locale=zh; foo=bar"), None)), "zh");
  }

  #[test]
  fn parse_cookie_no_match() {
    let set: HashSet<&str> = ["en", "zh"].iter().copied().collect();
    assert_eq!(parse_cookie_locale("lang=zh", "seam-locale", &set), None);
  }

  #[test]
  fn parse_accept_language_empty() {
    let set: HashSet<&str> = ["en"].iter().copied().collect();
    assert_eq!(parse_accept_language("", &set), None);
  }

  #[test]
  fn parse_accept_language_no_match() {
    let set: HashSet<&str> = ["en", "zh"].iter().copied().collect();
    assert_eq!(parse_accept_language("fr,de", &set), None);
  }
}
