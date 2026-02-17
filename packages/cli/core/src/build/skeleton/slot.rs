/* packages/cli/core/src/build/skeleton/slot.rs */

use std::sync::OnceLock;

use regex::Regex;

fn attr_re() -> &'static Regex {
  static RE: OnceLock<Regex> = OnceLock::new();
  RE.get_or_init(|| Regex::new(r#"([\w-]+)="%%SEAM:([^%]+)%%""#).unwrap())
}

fn style_sentinel_re() -> &'static Regex {
  static RE: OnceLock<Regex> = OnceLock::new();
  RE.get_or_init(|| Regex::new(r#"style="([^"]*%%SEAM:[^"]*)""#).unwrap())
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
/// Style sentinels: `style="margin-top:%%SEAM:mt%%"` inside tags
/// becomes `<!--seam:mt:style:margin-top-->` comment before the tag.
pub fn sentinel_to_slots(html: &str) -> String {
  let attr_re = attr_re();
  let text_re = text_re();
  let tag_re = tag_re();
  let style_re = style_sentinel_re();

  let mut result = String::with_capacity(html.len());
  let mut last_end = 0;

  for cap in tag_re.captures_iter(html) {
    let full_match = cap.get(0).unwrap();
    let attrs_part = cap.get(2).unwrap().as_str();

    let has_attr_sentinels = attr_re.is_match(attrs_part);
    let has_style_sentinels = style_re.is_match(attrs_part);

    // No sentinels at all, copy as-is
    if !has_attr_sentinels && !has_style_sentinels {
      result.push_str(&html[last_end..full_match.end()]);
      last_end = full_match.end();
      continue;
    }

    // Copy text between previous match and start of this tag
    result.push_str(&html[last_end..full_match.start()]);

    let mut working_attrs = attrs_part.to_string();
    let mut comments = Vec::new();

    // Process style sentinels first
    if has_style_sentinels {
      if let Some(style_cap) = style_re.captures(&working_attrs) {
        let style_value = style_cap[1].to_string();
        let mut static_pairs = Vec::new();

        for pair in style_value.split(';') {
          let pair = pair.trim();
          if pair.is_empty() {
            continue;
          }
          if pair.contains("%%SEAM:") {
            // Extract css_property (before first ':') and path (from sentinel)
            if let Some(colon_pos) = pair.find(':') {
              let css_property = &pair[..colon_pos];
              let value_part = &pair[colon_pos + 1..];
              // Extract path from %%SEAM:path%%
              if let (Some(start), Some(_end)) = (value_part.find("%%SEAM:"), value_part.find("%%"))
              {
                let after_prefix = &value_part[start + 7..];
                if let Some(end2) = after_prefix.find("%%") {
                  let path = &after_prefix[..end2];
                  comments.push(format!("<!--seam:{path}:style:{css_property}-->"));
                }
              }
            }
          } else {
            static_pairs.push(pair.to_string());
          }
        }

        // Replace style attribute in working attrs
        let full_style_match = style_cap.get(0).unwrap().as_str();
        if static_pairs.is_empty() {
          working_attrs = working_attrs.replace(full_style_match, "");
        } else {
          let new_style = format!(r#"style="{}""#, static_pairs.join(";"));
          working_attrs = working_attrs.replace(full_style_match, &new_style);
        }
      }
    }

    // Collect regular attribute sentinel comments
    if has_attr_sentinels {
      for attr_cap in attr_re.captures_iter(&working_attrs) {
        let attr_name = &attr_cap[1];
        let path = &attr_cap[2];
        comments.push(format!("<!--seam:{path}:attr:{attr_name}-->"));
      }
      // Remove attr sentinels from working attrs
      working_attrs = attr_re.replace_all(&working_attrs, "").to_string();
    }

    // Insert comments before the tag
    for comment in &comments {
      result.push_str(comment);
    }

    // Rebuild the tag
    let tag_name = cap.get(1).unwrap().as_str();
    let cleaned_attrs = working_attrs.trim();

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

  // -- Text escaping: sentinel in HTML-escaped context --

  #[test]
  fn sentinel_in_escaped_html_context() {
    // Sentinel surrounded by HTML entities — entities must not interfere
    let html = "<p>&amp; %%SEAM:user%% &lt;end&gt;</p>";
    let result = sentinel_to_slots(html);
    assert_eq!(result, "<p>&amp; <!--seam:user--> &lt;end&gt;</p>");
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

  // -- Style sentinel extraction --

  #[test]
  fn style_all_dynamic() {
    let html = r#"<div style="margin-top:%%SEAM:mt%%">text</div>"#;
    let result = sentinel_to_slots(html);
    assert_eq!(result, "<!--seam:mt:style:margin-top--><div>text</div>");
  }

  #[test]
  fn style_multi_dynamic() {
    let html = r#"<div style="margin-top:%%SEAM:mt%%;font-size:%%SEAM:fs%%">text</div>"#;
    let result = sentinel_to_slots(html);
    assert!(result.contains("<!--seam:mt:style:margin-top-->"));
    assert!(result.contains("<!--seam:fs:style:font-size-->"));
    assert!(result.contains("<div>text</div>"));
    assert!(!result.contains("style="));
  }

  #[test]
  fn style_mixed_static_dynamic() {
    let html = r#"<div style="color:red;margin-top:%%SEAM:mt%%">text</div>"#;
    let result = sentinel_to_slots(html);
    assert!(result.contains("<!--seam:mt:style:margin-top-->"));
    assert!(result.contains(r#"style="color:red""#));
    assert!(!result.contains("%%SEAM:"));
  }

  #[test]
  fn style_all_static_unchanged() {
    let html = r#"<div style="color:red;font-size:14px">text</div>"#;
    assert_eq!(sentinel_to_slots(html), html);
  }
}
