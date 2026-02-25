/* packages/cli/core/src/build/skeleton/extract/tests/nested.rs */

// Enum-in-array and triple nesting tests.

use super::*;

// -- Focused enum-in-array tests --

#[test]
fn extract_enum_inside_array() {
  let axes = vec![
    make_axis("items", "array", vec![json!("populated"), json!("empty")]),
    make_axis("items.$.status", "enum", vec![json!("active"), json!("paused"), json!("archived")]),
  ];

  fn gen(populated: bool, status: &str) -> String {
    if !populated {
      return "<ul></ul>".to_string();
    }
    let badge = match status {
      "active" => r#"<span class="badge-green">Active</span>"#,
      "paused" => r#"<span class="badge-yellow">Paused</span>"#,
      _ => r#"<span class="badge-gray">Archived</span>"#,
    };
    format!("<ul><li><!--seam:items.$.name-->{badge}</li></ul>")
  }

  let mut variants = Vec::new();
  for &pop in &[true, false] {
    for status in &["active", "paused", "archived"] {
      variants.push(gen(pop, status));
    }
  }

  assert_eq!(variants.len(), 6);
  let result = extract_template(&axes, &variants);

  assert!(result.contains("<!--seam:each:items-->"), "missing each:items in:\n{result}");
  assert!(result.contains("<!--seam:match:$.status-->"), "missing match:$.status in:\n{result}");
  assert!(result.contains("<!--seam:when:active-->"), "missing when:active in:\n{result}");
  assert!(result.contains("<!--seam:when:paused-->"), "missing when:paused in:\n{result}");
  assert!(result.contains("<!--seam:when:archived-->"), "missing when:archived in:\n{result}");
  assert!(result.contains("<!--seam:endmatch-->"), "missing endmatch in:\n{result}");
  assert!(result.contains("<!--seam:endeach-->"), "missing endeach in:\n{result}");
  assert!(result.contains("<!--seam:$.name-->"), "missing $.name in:\n{result}");
  assert!(!result.contains("items.$."), "leaked items.$.* path in:\n{result}");
}

#[test]
fn extract_enum_inside_array_with_fallback() {
  let axes = vec![
    make_axis("items", "array", vec![json!("populated"), json!("empty")]),
    make_axis("items.$.status", "enum", vec![json!("active"), json!("paused"), json!("archived")]),
  ];

  fn gen(populated: bool, status: &str) -> String {
    if !populated {
      return "<p>No items</p>".to_string();
    }
    let badge = match status {
      "active" => r#"<span class="badge-green">Active</span>"#,
      "paused" => r#"<span class="badge-yellow">Paused</span>"#,
      _ => r#"<span class="badge-gray">Archived</span>"#,
    };
    format!("<ul><li><!--seam:items.$.name-->{badge}</li></ul>")
  }

  let mut variants = Vec::new();
  for &pop in &[true, false] {
    for status in &["active", "paused", "archived"] {
      variants.push(gen(pop, status));
    }
  }

  assert_eq!(variants.len(), 6);
  let result = extract_template(&axes, &variants);

  assert!(result.contains("<!--seam:if:items-->"), "missing if:items in:\n{result}");
  assert!(result.contains("<!--seam:each:items-->"), "missing each:items in:\n{result}");
  assert!(result.contains("<!--seam:match:$.status-->"), "missing match:$.status in:\n{result}");
  assert!(result.contains("<!--seam:when:active-->"), "missing when:active in:\n{result}");
  assert!(result.contains("<!--seam:when:paused-->"), "missing when:paused in:\n{result}");
  assert!(result.contains("<!--seam:when:archived-->"), "missing when:archived in:\n{result}");
  assert!(result.contains("<!--seam:endmatch-->"), "missing endmatch in:\n{result}");
  assert!(result.contains("<!--seam:endeach-->"), "missing endeach in:\n{result}");
  assert!(result.contains("<!--seam:else-->"), "missing else in:\n{result}");
  assert!(result.contains("<p>No items</p>"), "missing fallback in:\n{result}");
  assert!(result.contains("<!--seam:endif:items-->"), "missing endif:items in:\n{result}");
  assert!(result.contains("<!--seam:$.name-->"), "missing $.name in:\n{result}");
  assert!(!result.contains("items.$."), "leaked items.$.* path in:\n{result}");
}

// -- Triple nesting tests --

#[test]
fn extract_triple_nesting_array_array_boolean() {
  let axes = vec![
    make_axis("categories", "array", vec![json!("populated"), json!("empty")]),
    make_axis("categories.$.posts", "array", vec![json!("populated"), json!("empty")]),
    make_axis("categories.$.posts.$.pinned", "boolean", vec![json!(true), json!(false)]),
  ];

  fn gen(cat_pop: bool, posts_pop: bool, pinned: bool) -> String {
    if !cat_pop {
      return "<div><p>No categories</p></div>".to_string();
    }
    let inner = if posts_pop {
      let pin = if pinned { "<span>Pinned</span>" } else { "" };
      format!("<ul><li><!--seam:categories.$.posts.$.title-->{pin}</li></ul>")
    } else {
      "<p>No posts</p>".to_string()
    };
    format!("<div><section><!--seam:categories.$.name-->{inner}</section></div>")
  }

  let mut variants = Vec::new();
  for &cat in &[true, false] {
    for &posts in &[true, false] {
      for &pinned in &[true, false] {
        variants.push(gen(cat, posts, pinned));
      }
    }
  }

  assert_eq!(variants.len(), 8);
  let result = extract_template(&axes, &variants);

  // Outer: categories array with fallback
  assert!(result.contains("<!--seam:if:categories-->"), "missing if:categories in:\n{result}");
  assert!(result.contains("<!--seam:each:categories-->"), "missing each:categories in:\n{result}");
  assert!(result.contains("<p>No categories</p>"), "missing categories fallback in:\n{result}");
  assert!(
    result.contains("<!--seam:endif:categories-->"),
    "missing endif:categories in:\n{result}"
  );

  // Inner: posts array with fallback (first prefix stripped)
  assert!(result.contains("<!--seam:if:$.posts-->"), "missing if:$.posts in:\n{result}");
  assert!(result.contains("<!--seam:each:$.posts-->"), "missing each:$.posts in:\n{result}");
  assert!(result.contains("<p>No posts</p>"), "missing posts fallback in:\n{result}");
  assert!(result.contains("<!--seam:endif:$.posts-->"), "missing endif:$.posts in:\n{result}");

  // Innermost: pinned boolean (second prefix stripped)
  assert!(result.contains("<!--seam:if:$.pinned-->"), "missing if:$.pinned in:\n{result}");
  assert!(result.contains("<span>Pinned</span>"), "missing Pinned in:\n{result}");
  assert!(result.contains("<!--seam:endif:$.pinned-->"), "missing endif:$.pinned in:\n{result}");

  // Slot markers correctly double-stripped
  assert!(result.contains("<!--seam:$.name-->"), "missing $.name slot in:\n{result}");
  assert!(result.contains("<!--seam:$.title-->"), "missing $.title slot in:\n{result}");

  // Structural counts
  assert_eq!(
    result.matches("<!--seam:endeach-->").count(),
    2,
    "expected 2 endeach (categories + posts) in:\n{result}"
  );
  assert_eq!(
    result.matches("<!--seam:else-->").count(),
    2,
    "expected 2 else (categories fallback + posts fallback) in:\n{result}"
  );

  // No leaked full paths
  assert!(!result.contains("categories.$."), "leaked categories.$.* path in:\n{result}");
}

#[test]
fn extract_triple_nesting_array_array_enum() {
  let axes = vec![
    make_axis("sections", "array", vec![json!("populated"), json!("empty")]),
    make_axis("sections.$.items", "array", vec![json!("populated"), json!("empty")]),
    make_axis(
      "sections.$.items.$.kind",
      "enum",
      vec![json!("text"), json!("image"), json!("video")],
    ),
  ];

  fn gen(sec_pop: bool, items_pop: bool, kind: &str) -> String {
    if !sec_pop {
      return "<div><p>No sections</p></div>".to_string();
    }
    let inner = if items_pop {
      let content = match kind {
        "text" => "<span>Text content</span>",
        "image" => "<img/>",
        _ => "<video></video>",
      };
      format!("<ol><li>{content}</li></ol>")
    } else {
      "<p>No items</p>".to_string()
    };
    format!("<div><section><!--seam:sections.$.heading-->{inner}</section></div>")
  }

  let mut variants = Vec::new();
  for &sec in &[true, false] {
    for &items in &[true, false] {
      for kind in &["text", "image", "video"] {
        variants.push(gen(sec, items, kind));
      }
    }
  }

  assert_eq!(variants.len(), 12);
  let result = extract_template(&axes, &variants);

  // Outer: sections array with fallback
  assert!(result.contains("<!--seam:if:sections-->"), "missing if:sections in:\n{result}");
  assert!(result.contains("<!--seam:each:sections-->"), "missing each:sections in:\n{result}");
  assert!(result.contains("<p>No sections</p>"), "missing sections fallback in:\n{result}");
  assert!(result.contains("<!--seam:endif:sections-->"), "missing endif:sections in:\n{result}");

  // Inner: items array with fallback
  assert!(result.contains("<!--seam:if:$.items-->"), "missing if:$.items in:\n{result}");
  assert!(result.contains("<!--seam:each:$.items-->"), "missing each:$.items in:\n{result}");
  assert!(result.contains("<p>No items</p>"), "missing items fallback in:\n{result}");
  assert!(result.contains("<!--seam:endif:$.items-->"), "missing endif:$.items in:\n{result}");

  // Innermost: kind enum (double prefix stripped)
  assert!(result.contains("<!--seam:match:$.kind-->"), "missing match:$.kind in:\n{result}");
  assert!(result.contains("<!--seam:when:text-->"), "missing when:text in:\n{result}");
  assert!(result.contains("<!--seam:when:image-->"), "missing when:image in:\n{result}");
  assert!(result.contains("<!--seam:when:video-->"), "missing when:video in:\n{result}");
  assert!(result.contains("<!--seam:endmatch-->"), "missing endmatch in:\n{result}");

  // Slot markers correctly stripped
  assert!(result.contains("<!--seam:$.heading-->"), "missing $.heading slot in:\n{result}");

  // Structural counts
  assert_eq!(
    result.matches("<!--seam:endeach-->").count(),
    2,
    "expected 2 endeach (sections + items) in:\n{result}"
  );
  assert_eq!(
    result.matches("<!--seam:else-->").count(),
    2,
    "expected 2 else (sections fallback + items fallback) in:\n{result}"
  );

  // No leaked full paths
  assert!(!result.contains("sections.$."), "leaked sections.$.* path in:\n{result}");
}
