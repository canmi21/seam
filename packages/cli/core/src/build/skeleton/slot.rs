/* packages/cli/core/src/build/skeleton/slot.rs */

use std::sync::OnceLock;

use regex::Regex;

fn attr_re() -> &'static Regex {
  static RE: OnceLock<Regex> = OnceLock::new();
  RE.get_or_init(|| Regex::new(r#"([\w-]+)="%%SEAM:([^%]+)%%""#).unwrap())
}

fn text_re() -> &'static Regex {
  static RE: OnceLock<Regex> = OnceLock::new();
  RE.get_or_init(|| Regex::new(r"%%SEAM:([^%]+)%%").unwrap())
}

fn tag_re() -> &'static Regex {
  static RE: OnceLock<Regex> = OnceLock::new();
  RE.get_or_init(|| Regex::new(r"<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>").unwrap())
}

/// Replace text sentinels `%%SEAM:path%%` with slot markers `<!--seam:path-->`.
/// Also handle attribute sentinels: `attr="%%SEAM:path%%"` inside tags
/// becomes a `<!--seam:path:attr:attrName-->` comment before the tag.
pub fn sentinel_to_slots(html: &str) -> String {
  let attr_re = attr_re();
  let text_re = text_re();
  let tag_re = tag_re();

  let mut result = String::with_capacity(html.len());
  let mut last_end = 0;

  for cap in tag_re.captures_iter(html) {
    let full_match = cap.get(0).unwrap();
    let attrs_part = cap.get(2).unwrap().as_str();

    // Check if this tag contains attribute sentinels
    if !attr_re.is_match(attrs_part) {
      // No attribute sentinels, copy as-is up to end of this match
      result.push_str(&html[last_end..full_match.end()]);
      last_end = full_match.end();
      continue;
    }

    // Copy text between previous match and start of this tag
    result.push_str(&html[last_end..full_match.start()]);

    // Collect attribute sentinel comments to insert before the tag
    let mut comments = Vec::new();
    for attr_cap in attr_re.captures_iter(attrs_part) {
      let attr_name = &attr_cap[1];
      let path = &attr_cap[2];
      comments.push(format!("<!--seam:{path}:attr:{attr_name}-->"));
    }

    // Insert comments before the tag
    for comment in &comments {
      result.push_str(comment);
    }

    // Rebuild the tag without the sentinel attributes
    let tag_name = cap.get(1).unwrap().as_str();
    let cleaned_attrs = attr_re.replace_all(attrs_part, "");
    let cleaned_attrs = cleaned_attrs.trim();

    if cleaned_attrs.is_empty() {
      result.push_str(&format!("<{tag_name}>"));
    } else {
      result.push_str(&format!("<{tag_name} {cleaned_attrs}>"));
    }

    last_end = full_match.end();
  }

  // Copy remaining text after last tag match
  result.push_str(&html[last_end..]);

  // Second pass: replace remaining text sentinels
  text_re.replace_all(&result, "<!--seam:$1-->").into_owned()
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn text_sentinels() {
    let html = "<p>%%SEAM:user.name%%</p>";
    assert_eq!(sentinel_to_slots(html), "<p><!--seam:user.name--></p>");
  }

  #[test]
  fn attribute_sentinels() {
    let html = r#"<img src="%%SEAM:user.avatar%%" alt="avatar">"#;
    let result = sentinel_to_slots(html);
    assert!(result.contains("<!--seam:user.avatar:attr:src-->"));
    assert!(!result.contains("%%SEAM:"));
    assert!(result.contains(r#"alt="avatar">"#));
  }

  #[test]
  fn mixed_sentinels() {
    let html = r#"<a href="%%SEAM:url%%">%%SEAM:label%%</a>"#;
    let result = sentinel_to_slots(html);
    assert!(result.contains("<!--seam:url:attr:href-->"));
    assert!(result.contains("<!--seam:label-->"));
    assert!(!result.contains("%%SEAM:"));
  }

  #[test]
  fn no_sentinels() {
    let html = "<p>Hello world</p>";
    assert_eq!(sentinel_to_slots(html), html);
  }

  #[test]
  fn multiple_text_sentinels() {
    let html = "<div>%%SEAM:a%% and %%SEAM:b%%</div>";
    let result = sentinel_to_slots(html);
    assert_eq!(result, "<div><!--seam:a--> and <!--seam:b--></div>");
  }

  #[test]
  fn preserves_react_ssr_comment_boundaries() {
    // React's renderToString inserts `<!-- -->` between adjacent text
    // fragments as text node boundaries. These MUST be preserved so
    // hydration sees the same DOM structure React expects.
    let html = "<span>by <!-- -->%%SEAM:author%%</span>";
    let result = sentinel_to_slots(html);
    assert_eq!(result, "<span>by <!-- --><!--seam:author--></span>");
  }

  // React 19 comment markers
  #[test]
  fn preserves_react_suspense_markers() {
    // React wraps resolved Suspense boundaries in <!--$-->...<!--/$-->
    let html = "<!--$--><div>%%SEAM:title%%</div><!--/$-->";
    let result = sentinel_to_slots(html);
    assert_eq!(result, "<!--$--><div><!--seam:title--></div><!--/$-->");
  }

  #[test]
  fn preserves_react_activity_markers() {
    // React wraps visible Activity boundaries in <!--&-->...<!--/&-->
    let html = "<!--&--><div>%%SEAM:content%%</div><!--/&-->";
    let result = sentinel_to_slots(html);
    assert_eq!(result, "<!--&--><div><!--seam:content--></div><!--/&-->");
  }

  // -- Diagnostic: hyphenated attribute names (#16, #17) --

  #[test]
  fn data_attr_sentinel() {
    // #16: data-* attrs use hyphens which \w does not match
    let html = r#"<div data-testid="%%SEAM:tid%%">content</div>"#;
    let result = sentinel_to_slots(html);
    assert!(
      result.contains("<!--seam:tid:attr:data-testid-->"),
      "data-testid sentinel not extracted: {result}"
    );
    assert!(!result.contains("%%SEAM:"), "raw sentinel remains: {result}");
  }

  #[test]
  fn aria_attr_sentinel() {
    // #17: aria-* attrs same hyphen issue
    let html = r#"<button aria-label="%%SEAM:label%%">click</button>"#;
    let result = sentinel_to_slots(html);
    assert!(
      result.contains("<!--seam:label:attr:aria-label-->"),
      "aria-label sentinel not extracted: {result}"
    );
    assert!(!result.contains("%%SEAM:"), "raw sentinel remains: {result}");
  }

  #[test]
  fn tabindex_void_element_no_trailing_space() {
    // #23b reclassification: tabIndex matches \w+, trim() cleans whitespace
    let html = r#"<input tabIndex="%%SEAM:ti%%">"#;
    let result = sentinel_to_slots(html);
    assert!(
      result.contains("<!--seam:ti:attr:tabIndex-->"),
      "tabIndex sentinel not extracted: {result}"
    );
    assert_eq!(result, "<!--seam:ti:attr:tabIndex--><input>");
  }

  #[test]
  fn data_attr_with_other_attrs() {
    // Compound case: non-hyphenated attr works but hyphenated fails
    let html = r#"<div class="x" data-id="%%SEAM:id%%">text</div>"#;
    let result = sentinel_to_slots(html);
    assert!(
      result.contains("<!--seam:id:attr:data-id-->"),
      "data-id sentinel not extracted: {result}"
    );
    assert!(!result.contains("%%SEAM:"), "raw sentinel remains: {result}");
  }

  #[test]
  fn multiple_hyphenated_attrs() {
    let html = r#"<div data-a="%%SEAM:a%%" aria-b="%%SEAM:b%%">text</div>"#;
    let result = sentinel_to_slots(html);
    assert!(
      result.contains("<!--seam:a:attr:data-a-->"),
      "data-a sentinel not extracted: {result}"
    );
    assert!(
      result.contains("<!--seam:b:attr:aria-b-->"),
      "aria-b sentinel not extracted: {result}"
    );
    assert!(!result.contains("%%SEAM:"), "raw sentinel remains: {result}");
  }
}
