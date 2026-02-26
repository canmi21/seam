/* packages/server/core/rust/src/resolve.rs */

use std::collections::HashSet;

pub trait ResolveStrategy: Send + Sync {
  fn kind(&self) -> &'static str;
  fn resolve(&self, data: &ResolveData) -> Option<String>;
}

pub struct ResolveData<'a> {
  pub url: &'a str,
  pub path_locale: Option<&'a str>,
  pub cookie_header: Option<&'a str>,
  pub accept_language: Option<&'a str>,
  pub locales: &'a [String],
  pub default_locale: &'a str,
}

// -- FromUrlPrefix --

pub struct FromUrlPrefix;

impl ResolveStrategy for FromUrlPrefix {
  fn kind(&self) -> &'static str {
    "url_prefix"
  }

  fn resolve(&self, data: &ResolveData) -> Option<String> {
    let loc = data.path_locale?;
    let locale_set: HashSet<&str> = data.locales.iter().map(|s| s.as_str()).collect();
    if locale_set.contains(loc) {
      Some(loc.to_string())
    } else {
      None
    }
  }
}

pub fn from_url_prefix() -> Box<dyn ResolveStrategy> {
  Box::new(FromUrlPrefix)
}

// -- FromCookie --

pub struct FromCookie {
  name: String,
}

impl ResolveStrategy for FromCookie {
  fn kind(&self) -> &'static str {
    "cookie"
  }

  fn resolve(&self, data: &ResolveData) -> Option<String> {
    let header = data.cookie_header?;
    let locale_set: HashSet<&str> = data.locales.iter().map(|s| s.as_str()).collect();
    for pair in header.split(';') {
      let pair = pair.trim();
      if let Some((k, v)) = pair.split_once('=') {
        if k.trim() == self.name {
          let v = v.trim();
          if locale_set.contains(v) {
            return Some(v.to_string());
          }
        }
      }
    }
    None
  }
}

pub fn from_cookie(name: &str) -> Box<dyn ResolveStrategy> {
  Box::new(FromCookie { name: name.to_string() })
}

// -- FromAcceptLanguage --

pub struct FromAcceptLanguage;

impl ResolveStrategy for FromAcceptLanguage {
  fn kind(&self) -> &'static str {
    "accept_language"
  }

  fn resolve(&self, data: &ResolveData) -> Option<String> {
    let header = data.accept_language?;
    if header.is_empty() {
      return None;
    }

    let locale_set: HashSet<&str> = data.locales.iter().map(|s| s.as_str()).collect();

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
}

pub fn from_accept_language() -> Box<dyn ResolveStrategy> {
  Box::new(FromAcceptLanguage)
}

// -- FromUrlQuery --

pub struct FromUrlQuery {
  param: String,
}

impl ResolveStrategy for FromUrlQuery {
  fn kind(&self) -> &'static str {
    "url_query"
  }

  fn resolve(&self, data: &ResolveData) -> Option<String> {
    let query_str = data.url.split_once('?').map(|(_, q)| q)?;
    let locale_set: HashSet<&str> = data.locales.iter().map(|s| s.as_str()).collect();
    for pair in query_str.split('&') {
      if let Some((k, v)) = pair.split_once('=') {
        if k == self.param && locale_set.contains(v) {
          return Some(v.to_string());
        }
      }
    }
    None
  }
}

pub fn from_url_query(param: &str) -> Box<dyn ResolveStrategy> {
  Box::new(FromUrlQuery { param: param.to_string() })
}

// -- Chain runner --

pub fn resolve_chain(strategies: &[Box<dyn ResolveStrategy>], data: &ResolveData) -> String {
  for s in strategies {
    if let Some(locale) = s.resolve(data) {
      return locale;
    }
  }
  data.default_locale.to_string()
}

/// Default strategy chain: url_prefix -> cookie("seam-locale") -> accept-language
pub fn default_strategies() -> Vec<Box<dyn ResolveStrategy>> {
  vec![from_url_prefix(), from_cookie("seam-locale"), from_accept_language()]
}

#[cfg(test)]
mod tests {
  use super::*;

  fn locales() -> Vec<String> {
    vec!["en".into(), "zh".into(), "ja".into()]
  }

  fn make_data<'a>(
    url: &'a str,
    path_locale: Option<&'a str>,
    cookie_header: Option<&'a str>,
    accept_language: Option<&'a str>,
    locales: &'a [String],
    default_locale: &'a str,
  ) -> ResolveData<'a> {
    ResolveData { url, path_locale, cookie_header, accept_language, locales, default_locale }
  }

  // -- FromUrlPrefix tests --

  #[test]
  fn url_prefix_valid_locale() {
    let locs = locales();
    let data = make_data("", Some("zh"), None, None, &locs, "en");
    assert_eq!(FromUrlPrefix.resolve(&data), Some("zh".into()));
  }

  #[test]
  fn url_prefix_invalid_locale() {
    let locs = locales();
    let data = make_data("", Some("fr"), None, None, &locs, "en");
    assert_eq!(FromUrlPrefix.resolve(&data), None);
  }

  #[test]
  fn url_prefix_none() {
    let locs = locales();
    let data = make_data("", None, None, None, &locs, "en");
    assert_eq!(FromUrlPrefix.resolve(&data), None);
  }

  // -- FromCookie tests --

  #[test]
  fn cookie_valid_locale() {
    let locs = locales();
    let strategy = FromCookie { name: "seam-locale".into() };
    let data = make_data("", None, Some("seam-locale=ja"), None, &locs, "en");
    assert_eq!(strategy.resolve(&data), Some("ja".into()));
  }

  #[test]
  fn cookie_invalid_locale() {
    let locs = locales();
    let strategy = FromCookie { name: "seam-locale".into() };
    let data = make_data("", None, Some("seam-locale=fr"), None, &locs, "en");
    assert_eq!(strategy.resolve(&data), None);
  }

  #[test]
  fn cookie_multiple_pairs() {
    let locs = locales();
    let strategy = FromCookie { name: "seam-locale".into() };
    let data = make_data("", None, Some("other=1; seam-locale=zh; foo=bar"), None, &locs, "en");
    assert_eq!(strategy.resolve(&data), Some("zh".into()));
  }

  #[test]
  fn cookie_wrong_name() {
    let locs = locales();
    let strategy = FromCookie { name: "seam-locale".into() };
    let data = make_data("", None, Some("lang=zh"), None, &locs, "en");
    assert_eq!(strategy.resolve(&data), None);
  }

  #[test]
  fn cookie_no_header() {
    let locs = locales();
    let strategy = FromCookie { name: "seam-locale".into() };
    let data = make_data("", None, None, None, &locs, "en");
    assert_eq!(strategy.resolve(&data), None);
  }

  // -- FromAcceptLanguage tests --

  #[test]
  fn accept_language_exact_match() {
    let locs = locales();
    let data = make_data("", None, None, Some("zh,en;q=0.5"), &locs, "en");
    assert_eq!(FromAcceptLanguage.resolve(&data), Some("zh".into()));
  }

  #[test]
  fn accept_language_q_value_priority() {
    let locs = locales();
    let data = make_data("", None, None, Some("en;q=0.5,zh;q=0.9"), &locs, "en");
    assert_eq!(FromAcceptLanguage.resolve(&data), Some("zh".into()));
  }

  #[test]
  fn accept_language_prefix_match() {
    let locs = locales();
    let data = make_data("", None, None, Some("zh-CN,en;q=0.5"), &locs, "en");
    assert_eq!(FromAcceptLanguage.resolve(&data), Some("zh".into()));
  }

  #[test]
  fn accept_language_no_match() {
    let locs = locales();
    let data = make_data("", None, None, Some("fr,de"), &locs, "en");
    assert_eq!(FromAcceptLanguage.resolve(&data), None);
  }

  #[test]
  fn accept_language_empty() {
    let locs = locales();
    let data = make_data("", None, None, Some(""), &locs, "en");
    assert_eq!(FromAcceptLanguage.resolve(&data), None);
  }

  #[test]
  fn accept_language_no_header() {
    let locs = locales();
    let data = make_data("", None, None, None, &locs, "en");
    assert_eq!(FromAcceptLanguage.resolve(&data), None);
  }

  // -- FromUrlQuery tests --

  #[test]
  fn url_query_valid_locale() {
    let locs = locales();
    let strategy = FromUrlQuery { param: "lang".into() };
    let data = make_data("/page?lang=zh", None, None, None, &locs, "en");
    assert_eq!(strategy.resolve(&data), Some("zh".into()));
  }

  #[test]
  fn url_query_invalid_locale() {
    let locs = locales();
    let strategy = FromUrlQuery { param: "lang".into() };
    let data = make_data("/page?lang=fr", None, None, None, &locs, "en");
    assert_eq!(strategy.resolve(&data), None);
  }

  #[test]
  fn url_query_no_query_string() {
    let locs = locales();
    let strategy = FromUrlQuery { param: "lang".into() };
    let data = make_data("/page", None, None, None, &locs, "en");
    assert_eq!(strategy.resolve(&data), None);
  }

  #[test]
  fn url_query_wrong_param() {
    let locs = locales();
    let strategy = FromUrlQuery { param: "lang".into() };
    let data = make_data("/page?locale=zh", None, None, None, &locs, "en");
    assert_eq!(strategy.resolve(&data), None);
  }

  #[test]
  fn url_query_multiple_params() {
    let locs = locales();
    let strategy = FromUrlQuery { param: "lang".into() };
    let data = make_data("/page?foo=bar&lang=ja&baz=1", None, None, None, &locs, "en");
    assert_eq!(strategy.resolve(&data), Some("ja".into()));
  }

  // -- Chain composition tests --

  #[test]
  fn chain_priority_ordering() {
    let locs = locales();
    let strategies: Vec<Box<dyn ResolveStrategy>> =
      vec![from_url_prefix(), from_cookie("seam-locale"), from_accept_language()];
    // url_prefix wins over cookie
    let data = make_data("", Some("zh"), Some("seam-locale=ja"), Some("en"), &locs, "en");
    assert_eq!(resolve_chain(&strategies, &data), "zh");
  }

  #[test]
  fn chain_falls_to_cookie() {
    let locs = locales();
    let strategies: Vec<Box<dyn ResolveStrategy>> =
      vec![from_url_prefix(), from_cookie("seam-locale"), from_accept_language()];
    let data = make_data("", None, Some("seam-locale=ja"), Some("zh"), &locs, "en");
    assert_eq!(resolve_chain(&strategies, &data), "ja");
  }

  #[test]
  fn chain_falls_to_accept_language() {
    let locs = locales();
    let strategies: Vec<Box<dyn ResolveStrategy>> =
      vec![from_url_prefix(), from_cookie("seam-locale"), from_accept_language()];
    let data = make_data("", None, None, Some("zh,en;q=0.5"), &locs, "en");
    assert_eq!(resolve_chain(&strategies, &data), "zh");
  }

  #[test]
  fn chain_falls_to_default() {
    let locs = locales();
    let strategies: Vec<Box<dyn ResolveStrategy>> =
      vec![from_url_prefix(), from_cookie("seam-locale"), from_accept_language()];
    let data = make_data("", None, None, None, &locs, "en");
    assert_eq!(resolve_chain(&strategies, &data), "en");
  }

  #[test]
  fn empty_chain_falls_to_default() {
    let locs = locales();
    let strategies: Vec<Box<dyn ResolveStrategy>> = vec![];
    let data = make_data("", Some("zh"), Some("seam-locale=ja"), Some("zh"), &locs, "en");
    assert_eq!(resolve_chain(&strategies, &data), "en");
  }

  #[test]
  fn default_strategies_produces_three() {
    let strategies = default_strategies();
    assert_eq!(strategies.len(), 3);
    assert_eq!(strategies[0].kind(), "url_prefix");
    assert_eq!(strategies[1].kind(), "cookie");
    assert_eq!(strategies[2].kind(), "accept_language");
  }
}
