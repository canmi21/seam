/* packages/cli/core/src/build/skeleton/extract/mod.rs */

mod combo;
mod container;
mod diff;
mod process;
mod variant;

use std::collections::HashSet;

use super::Axis;
use combo::classify_axes;
use process::{process_array_with_children, process_single_axis};

#[derive(Debug)]
struct AxisEffect {
  start: usize,
  end: usize,
  replacement: String,
}

/// Core recursive extraction engine.
fn extract_template_inner(axes: &[Axis], variants: &[String]) -> String {
  if variants.is_empty() {
    return String::new();
  }
  if variants.len() == 1 || axes.is_empty() {
    return variants[0].clone();
  }

  let base = &variants[0];
  let mut effects: Vec<AxisEffect> = Vec::new();

  // 1. Classify axes into top-level and nested groups
  let (top_level, groups) = classify_axes(axes);

  // 2. Track axes handled by groups (parent + all children)
  let mut handled: HashSet<usize> = HashSet::new();
  for group in &groups {
    handled.insert(group.parent_axis_idx);
    for &child in &group.children {
      handled.insert(child);
    }
    if let Some(effect) = process_array_with_children(axes, variants, group, base) {
      effects.push(effect);
    }
  }

  // 3. Process remaining top-level axes not owned by any group
  for &idx in &top_level {
    if handled.contains(&idx) {
      continue;
    }
    if let Some(effect) = process_single_axis(axes, variants, idx, base) {
      effects.push(effect);
    }
  }

  // 4. Apply effects back-to-front, adjusting indices for overlapping ranges.
  //    When a higher-start effect is applied first and a lower-start effect's
  //    end extends past it (overlap), the lower effect's end must be adjusted
  //    by the length delta of the higher effect's replacement.
  effects.sort_by(|a, b| b.start.cmp(&a.start));

  let mut result = base.to_string();
  for i in 0..effects.len() {
    let start = effects[i].start;
    let end = effects[i].end;
    let old_len = end - start;
    let new_len = effects[i].replacement.len();
    result = format!("{}{}{}", &result[..start], effects[i].replacement, &result[end..]);

    // Adjust subsequent effects whose end extends past this effect's start
    if old_len != new_len {
      let delta = new_len as isize - old_len as isize;
      for effect in effects.iter_mut().skip(i + 1) {
        if effect.end > start {
          effect.end = (effect.end as isize + delta) as usize;
        }
      }
    }
  }

  result
}

/// Extract a complete Slot Protocol v2 template from variant HTML strings.
/// Uses the axes metadata to determine which variants to diff for each axis.
/// Handles nested axes (e.g. `posts.$.author` inside a `posts` array)
/// via recursive sub-extraction.
pub fn extract_template(axes: &[Axis], variants: &[String]) -> String {
  extract_template_inner(axes, variants)
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;

  // -- Legacy v1 helpers (test-only, kept for regression coverage) --

  fn detect_conditional(
    full_html: &str,
    nulled_html: &str,
    field: &str,
  ) -> Option<ConditionalBlock> {
    if full_html == nulled_html {
      return None;
    }
    let prefix_len = full_html.bytes().zip(nulled_html.bytes()).take_while(|(a, b)| a == b).count();
    let full_remaining = &full_html[prefix_len..];
    let nulled_remaining = &nulled_html[prefix_len..];
    let suffix_len = full_remaining
      .bytes()
      .rev()
      .zip(nulled_remaining.bytes().rev())
      .take_while(|(a, b)| a == b)
      .count();
    let mut block_start = prefix_len;
    let mut block_end = full_html.len() - suffix_len;
    if block_start > 0 && full_html.as_bytes()[block_start - 1] == b'<' {
      block_start -= 1;
    }
    if block_end > block_start && full_html.as_bytes()[block_end - 1] == b'<' {
      block_end -= 1;
    }
    if block_start >= block_end {
      return None;
    }
    Some(ConditionalBlock { start: block_start, end: block_end, field: field.to_string() })
  }

  #[derive(Debug)]
  struct ConditionalBlock {
    start: usize,
    end: usize,
    field: String,
  }

  fn apply_conditionals(html: &str, mut blocks: Vec<ConditionalBlock>) -> String {
    let mut result = html.to_string();
    blocks.sort_by(|a, b| b.start.cmp(&a.start));
    for block in &blocks {
      let endif = format!("<!--seam:endif:{}-->", block.field);
      let ifstart = format!("<!--seam:if:{}-->", block.field);
      result.insert_str(block.end, &endif);
      result.insert_str(block.start, &ifstart);
    }
    result
  }

  fn detect_array_block(full_html: &str, emptied_html: &str, field: &str) -> Option<ArrayBlock> {
    if full_html == emptied_html {
      return None;
    }
    let prefix_len =
      full_html.bytes().zip(emptied_html.bytes()).take_while(|(a, b)| a == b).count();
    let full_remaining = &full_html[prefix_len..];
    let emptied_remaining = &emptied_html[prefix_len..];
    let suffix_len = full_remaining
      .bytes()
      .rev()
      .zip(emptied_remaining.bytes().rev())
      .take_while(|(a, b)| a == b)
      .count();
    let mut block_start = prefix_len;
    let mut block_end = full_html.len() - suffix_len;
    if block_start > 0 && full_html.as_bytes()[block_start - 1] == b'<' {
      block_start -= 1;
    }
    if block_end > block_start && full_html.as_bytes()[block_end - 1] == b'<' {
      block_end -= 1;
    }
    if block_start >= block_end {
      return None;
    }
    Some(ArrayBlock { start: block_start, end: block_end, field: field.to_string() })
  }

  #[derive(Debug)]
  struct ArrayBlock {
    start: usize,
    end: usize,
    field: String,
  }

  fn apply_array_blocks(html: &str, mut blocks: Vec<ArrayBlock>) -> String {
    let mut result = html.to_string();
    blocks.sort_by(|a, b| b.start.cmp(&a.start));
    for block in &blocks {
      let body = &result[block.start..block.end];
      let field_prefix = format!("<!--seam:{}.", block.field);
      let replacement_prefix = "<!--seam:";
      let renamed = body.replace(&field_prefix, replacement_prefix);
      let wrapped = format!("<!--seam:each:{}-->{}<!--seam:endeach-->", block.field, renamed);
      result = format!("{}{}{}", &result[..block.start], wrapped, &result[block.end..]);
    }
    result
  }

  fn make_axis(path: &str, kind: &str, values: Vec<serde_json::Value>) -> Axis {
    Axis { path: path.to_string(), kind: kind.to_string(), values }
  }

  // -- Legacy v1 detect/apply tests --

  #[test]
  fn simple_conditional() {
    let full = "<div>Hello<span>Avatar</span>World</div>";
    let nulled = "<div>HelloWorld</div>";
    let block = detect_conditional(full, nulled, "user.avatar").unwrap();
    assert_eq!(&full[block.start..block.end], "<span>Avatar</span>");
  }

  #[test]
  fn identical_html_no_conditional() {
    let html = "<div>Same</div>";
    assert!(detect_conditional(html, html, "field").is_none());
  }

  #[test]
  fn apply_multiple_conditionals() {
    let html = "<div><p>A</p><p>B</p><p>C</p></div>";
    let blocks = vec![
      ConditionalBlock { start: 5, end: 13, field: "a".into() },
      ConditionalBlock { start: 13, end: 21, field: "b".into() },
    ];
    let result = apply_conditionals(html, blocks);
    assert!(result.contains("<!--seam:if:a--><p>A</p><!--seam:endif:a-->"));
    assert!(result.contains("<!--seam:if:b--><p>B</p><!--seam:endif:b-->"));
  }

  #[test]
  fn array_block_detection() {
    let full = "before<li><!--seam:items.$.name--></li>after";
    let emptied = "beforeafter";
    let block = detect_array_block(full, emptied, "items").unwrap();
    assert_eq!(&full[block.start..block.end], "<li><!--seam:items.$.name--></li>");
  }

  #[test]
  fn array_block_detection_shared_angle_bracket() {
    let full = "<ul><li><!--seam:items.$.name--></li></ul>";
    let emptied = "<ul></ul>";
    let block = detect_array_block(full, emptied, "items").unwrap();
    assert_eq!(&full[block.start..block.end], "<li><!--seam:items.$.name--></li>");
  }

  #[test]
  fn array_block_identical_no_detection() {
    assert!(detect_array_block("<ul></ul>", "<ul></ul>", "items").is_none());
  }

  #[test]
  fn apply_array_blocks_wraps_and_renames() {
    let html = "<ul><li><!--seam:items.$.name--></li></ul>";
    let blocks = vec![ArrayBlock { start: 4, end: 37, field: "items".into() }];
    let result = apply_array_blocks(html, blocks);
    assert!(result.contains("<!--seam:each:items-->"));
    assert!(result.contains("<!--seam:endeach-->"));
    assert!(result.contains("<!--seam:$.name-->"));
    assert!(!result.contains("items.$.name"));
  }

  #[test]
  fn apply_array_blocks_renames_attr_paths() {
    let html = "<ul><!--seam:items.$.url:attr:href--><a><!--seam:items.$.text--></a></ul>";
    let block_start = 4;
    let block_end = html.len() - 5;
    let blocks = vec![ArrayBlock { start: block_start, end: block_end, field: "items".into() }];
    let result = apply_array_blocks(html, blocks);
    assert!(result.contains("<!--seam:$.url:attr:href-->"));
    assert!(result.contains("<!--seam:$.text-->"));
    assert!(!result.contains("items.$"));
  }

  // -- extract_template: flat axis tests --

  #[test]
  fn extract_boolean_if_only() {
    let axes = vec![make_axis("isAdmin", "boolean", vec![json!(true), json!(false)])];
    let variants =
      vec!["<div>Hello<span>Admin</span></div>".to_string(), "<div>Hello</div>".to_string()];
    let result = extract_template(&axes, &variants);
    assert!(result.contains("<!--seam:if:isAdmin-->"));
    assert!(result.contains("<span>Admin</span>"));
    assert!(result.contains("<!--seam:endif:isAdmin-->"));
  }

  #[test]
  fn extract_boolean_if_else() {
    let axes = vec![make_axis("isLoggedIn", "boolean", vec![json!(true), json!(false)])];
    let variants =
      vec!["<div><b>Welcome</b></div>".to_string(), "<div><i>Login</i></div>".to_string()];
    let result = extract_template(&axes, &variants);
    assert!(result.contains("<!--seam:if:isLoggedIn-->"));
    assert!(result.contains("<b>Welcome</b>"));
    assert!(result.contains("<!--seam:else-->"));
    assert!(result.contains("<i>Login</i>"));
    assert!(result.contains("<!--seam:endif:isLoggedIn-->"));
  }

  #[test]
  fn extract_enum_match() {
    let axes =
      vec![make_axis("role", "enum", vec![json!("admin"), json!("member"), json!("guest")])];
    let variants = vec![
      "<div><b>Admin Panel</b></div>".to_string(),
      "<div><i>Member Area</i></div>".to_string(),
      "<div><span>Guest View</span></div>".to_string(),
    ];
    let result = extract_template(&axes, &variants);
    assert!(result.contains("<!--seam:match:role-->"));
    assert!(result.contains("<!--seam:when:admin-->"));
    assert!(result.contains("<!--seam:when:member-->"));
    assert!(result.contains("<!--seam:when:guest-->"));
    assert!(result.contains("<!--seam:endmatch-->"));
  }

  #[test]
  fn extract_array_each() {
    let axes = vec![make_axis("posts", "array", vec![json!("populated"), json!("empty")])];
    let variants =
      vec!["<ul><li><!--seam:posts.$.name--></li></ul>".to_string(), "<ul></ul>".to_string()];
    let result = extract_template(&axes, &variants);
    assert!(result.contains("<!--seam:each:posts-->"));
    assert!(result.contains("<!--seam:$.name-->"));
    assert!(result.contains("<!--seam:endeach-->"));
    assert!(!result.contains("posts.$.name"));
  }

  #[test]
  fn extract_single_variant_passthrough() {
    let axes: Vec<Axis> = vec![];
    let variants = vec!["<div>Hello</div>".to_string()];
    assert_eq!(extract_template(&axes, &variants), "<div>Hello</div>");
  }

  // -- extract_template: nested axis tests --

  #[test]
  fn extract_array_with_nested_boolean() {
    let axes = vec![
      make_axis("posts", "array", vec![json!("populated"), json!("empty")]),
      make_axis("posts.$.hasAuthor", "boolean", vec![json!(true), json!(false)]),
    ];
    let variants = vec![
      "<ul><li>Title<span>Author</span></li></ul>".to_string(),
      "<ul><li>Title</li></ul>".to_string(),
      "<ul></ul>".to_string(),
      "<ul></ul>".to_string(),
    ];
    let result = extract_template(&axes, &variants);
    assert!(result.contains("<!--seam:each:posts-->"), "missing each:posts in: {result}");
    assert!(result.contains("<!--seam:if:$.hasAuthor-->"), "missing if:$.hasAuthor in: {result}");
    assert!(result.contains("<span>Author</span>"), "missing Author block in: {result}");
    assert!(
      result.contains("<!--seam:endif:$.hasAuthor-->"),
      "missing endif:$.hasAuthor in: {result}"
    );
    assert!(result.contains("<!--seam:endeach-->"), "missing endeach in: {result}");
    // Nested paths must be fully renamed
    assert!(!result.contains("posts.$.hasAuthor"), "leaked full path in: {result}");
  }

  #[test]
  fn extract_array_with_nested_nullable() {
    let axes = vec![
      make_axis("items", "array", vec![json!("populated"), json!("empty")]),
      make_axis("items.$.subtitle", "nullable", vec![json!("present"), json!(null)]),
    ];
    let variants = vec![
      "<ol><li>Main<em>Sub</em></li></ol>".to_string(),
      "<ol><li>Main</li></ol>".to_string(),
      "<ol></ol>".to_string(),
      "<ol></ol>".to_string(),
    ];
    let result = extract_template(&axes, &variants);
    assert!(result.contains("<!--seam:each:items-->"), "missing each in: {result}");
    assert!(result.contains("<!--seam:if:$.subtitle-->"), "missing if in: {result}");
    assert!(result.contains("<em>Sub</em>"), "missing Sub block in: {result}");
    assert!(result.contains("<!--seam:endif:$.subtitle-->"), "missing endif in: {result}");
    assert!(result.contains("<!--seam:endeach-->"), "missing endeach in: {result}");
  }

  #[test]
  fn extract_mixed_toplevel_and_nested() {
    let axes = vec![
      make_axis("isAdmin", "boolean", vec![json!(true), json!(false)]),
      make_axis("posts", "array", vec![json!("populated"), json!("empty")]),
      make_axis("posts.$.hasImage", "boolean", vec![json!(true), json!(false)]),
      make_axis("posts.$.caption", "nullable", vec![json!("present"), json!(null)]),
    ];

    // Helper to build variant HTML from axis values
    fn gen(is_admin: bool, posts_pop: bool, has_image: bool, has_caption: bool) -> String {
      let admin = if is_admin { "<b>Admin</b>" } else { "" };
      let img = if has_image { "<img/>" } else { "" };
      let cap = if has_caption { "<em>Cap</em>" } else { "" };
      let items = if posts_pop { format!("<li>Post{img}{cap}</li>") } else { String::new() };
      format!("<div>{admin}<ul>{items}</ul></div>")
    }

    // 16 variants: cartesian product of (isAdmin, posts, hasImage, caption)
    let variants = vec![
      gen(true, true, true, true),     // 0
      gen(true, true, true, false),    // 1
      gen(true, true, false, true),    // 2
      gen(true, true, false, false),   // 3
      gen(true, false, true, true),    // 4
      gen(true, false, true, false),   // 5
      gen(true, false, false, true),   // 6
      gen(true, false, false, false),  // 7
      gen(false, true, true, true),    // 8
      gen(false, true, true, false),   // 9
      gen(false, true, false, true),   // 10
      gen(false, true, false, false),  // 11
      gen(false, false, true, true),   // 12
      gen(false, false, true, false),  // 13
      gen(false, false, false, true),  // 14
      gen(false, false, false, false), // 15
    ];

    let result = extract_template(&axes, &variants);

    // Top-level boolean
    assert!(result.contains("<!--seam:if:isAdmin-->"), "missing if:isAdmin in: {result}");
    assert!(result.contains("<b>Admin</b>"), "missing Admin block in: {result}");
    assert!(result.contains("<!--seam:endif:isAdmin-->"), "missing endif:isAdmin in: {result}");

    // Array
    assert!(result.contains("<!--seam:each:posts-->"), "missing each:posts in: {result}");
    assert!(result.contains("<!--seam:endeach-->"), "missing endeach in: {result}");

    // Nested boolean inside array
    assert!(result.contains("<!--seam:if:$.hasImage-->"), "missing if:$.hasImage in: {result}");
    assert!(result.contains("<img/>"), "missing img in: {result}");
    assert!(
      result.contains("<!--seam:endif:$.hasImage-->"),
      "missing endif:$.hasImage in: {result}"
    );

    // Nested nullable inside array
    assert!(result.contains("<!--seam:if:$.caption-->"), "missing if:$.caption in: {result}");
    assert!(result.contains("<em>Cap</em>"), "missing Cap block in: {result}");
    assert!(result.contains("<!--seam:endif:$.caption-->"), "missing endif:$.caption in: {result}");

    // No leaked full paths
    assert!(!result.contains("posts.$."), "leaked nested path in: {result}");
  }

  #[test]
  fn extract_array_without_children_unchanged() {
    // Regression guard: arrays without nested children still work correctly
    let axes = vec![make_axis("posts", "array", vec![json!("populated"), json!("empty")])];
    let variants =
      vec!["<ul><li><!--seam:posts.$.name--></li></ul>".to_string(), "<ul></ul>".to_string()];
    let result = extract_template(&axes, &variants);
    assert_eq!(
      result,
      "<ul><!--seam:each:posts--><li><!--seam:$.name--></li><!--seam:endeach--></ul>"
    );
  }

  // -- HomeSkeleton regression: exercises all 4 extraction bugs --

  #[test]
  fn extract_home_skeleton_regression() {
    let axes = vec![
      make_axis("isLoggedIn", "boolean", vec![json!(true), json!(false)]),
      make_axis("posts", "array", vec![json!("populated"), json!("empty")]),
      make_axis("posts.$.isPublished", "boolean", vec![json!(true), json!(false)]),
      make_axis("posts.$.priority", "enum", vec![json!("high"), json!("medium"), json!("low")]),
    ];

    fn gen(logged_in: bool, posts_pop: bool, published: bool, priority: &str) -> String {
      let status = if logged_in {
        r#"<p class="text-green">Signed in</p>"#
      } else {
        r#"<p class="text-gray">Please sign in</p>"#
      };
      let posts_html = if posts_pop {
        let border = match priority {
          "high" => "border-red",
          "medium" => "border-amber",
          _ => "border-gray",
        };
        let pri_label = match priority {
          "high" => "High",
          "medium" => "Medium",
          _ => "Low",
        };
        let pub_html = if published { "<span>Published</span>" } else { "" };
        format!(
          r#"<ul class="list"><li class="{border}"><!--seam:posts.$.title-->{pub_html}<span>Priority: {pri_label}</span></li></ul>"#
        )
      } else {
        "<p>No posts</p>".to_string()
      };
      format!("<div>{status}{posts_html}</div>")
    }

    // Cartesian product: isLoggedIn(2) * posts(2) * isPublished(2) * priority(3) = 24
    let mut variants = Vec::new();
    for &logged_in in &[true, false] {
      for &posts_pop in &[true, false] {
        for &published in &[true, false] {
          for priority in &["high", "medium", "low"] {
            variants.push(gen(logged_in, posts_pop, published, priority));
          }
        }
      }
    }

    let result = extract_template(&axes, &variants);

    // Bug 4: diff boundary must not split inside class attribute
    assert!(
      !result.contains(r#"class="text-<!--seam:"#),
      "Bug 4: diff split inside class attribute in:\n{result}"
    );

    // Bug 1: <ul> must NOT be inside the each loop (container should stay outside)
    assert!(
      !result.contains("<!--seam:each:posts--><ul"),
      "Bug 1: container duplicated inside each loop in:\n{result}"
    );

    // Bug 2: all seam comments must be well-formed (no broken "-seam:" without "<!--")
    for (i, _) in result.match_indices("-seam:endif") {
      assert!(
        i >= 3 && &result[i - 3..i] == "<!-",
        "Bug 2: malformed endif comment at byte {i} in:\n{result}"
      );
    }

    // Bug 3: no stale content leaking after endmatch
    if let Some(after) = result.split("<!--seam:endmatch-->").nth(1) {
      let before_next_tag = after.split('<').next().unwrap_or("");
      assert!(
        !before_next_tag.contains("Priority:"),
        "Bug 3: stale content after endmatch in:\n{result}"
      );
    }

    // Positive structural assertions
    assert!(result.contains("<!--seam:if:isLoggedIn-->"), "missing if:isLoggedIn in:\n{result}");
    assert!(result.contains("<!--seam:else-->"), "missing else in:\n{result}");
    assert!(
      result.contains("<!--seam:endif:isLoggedIn-->"),
      "missing endif:isLoggedIn in:\n{result}"
    );
    assert!(result.contains("<!--seam:each:posts-->"), "missing each:posts in:\n{result}");
    assert!(result.contains("<!--seam:endeach-->"), "missing endeach in:\n{result}");
    assert!(
      result.contains("<!--seam:if:$.isPublished-->"),
      "missing if:$.isPublished in:\n{result}"
    );
    assert!(
      result.contains("<!--seam:endif:$.isPublished-->"),
      "missing endif:$.isPublished in:\n{result}"
    );
    assert!(
      result.contains("<!--seam:match:$.priority-->"),
      "missing match:$.priority in:\n{result}"
    );
    assert!(result.contains("<!--seam:when:high-->"), "missing when:high in:\n{result}");
    assert!(result.contains("<!--seam:endmatch-->"), "missing endmatch in:\n{result}");
    assert!(!result.contains("posts.$."), "leaked nested path in:\n{result}");
  }

  #[test]
  fn extract_boolean_if_else_in_class_attribute() {
    // Targeted Bug 4 test: boolean axis where diff falls inside a class attribute
    let axes = vec![make_axis("dark", "boolean", vec![json!(true), json!(false)])];
    let variants = vec![
      r#"<div class="bg-black text-white">Dark</div>"#.to_string(),
      r#"<div class="bg-white text-black">Light</div>"#.to_string(),
    ];
    let result = extract_template(&axes, &variants);
    // The entire <div> should be wrapped, not just partial class values
    assert!(
      !result.contains(r#"class=""#) || !result.contains("<!--seam:if:dark-->text-"),
      "diff boundary inside class attribute in:\n{result}"
    );
    // The if/else should wrap complete elements
    assert!(result.contains("<!--seam:if:dark-->"), "missing if in:\n{result}");
    assert!(result.contains("<!--seam:else-->"), "missing else in:\n{result}");
    assert!(result.contains("<!--seam:endif:dark-->"), "missing endif in:\n{result}");
  }

  #[test]
  fn extract_array_container_unwrap() {
    // Targeted Bug 1 test: array body captured with its <ul> container
    let axes = vec![make_axis("items", "array", vec![json!("populated"), json!("empty")])];
    let variants = vec![
      r#"<div><ul class="list"><li><!--seam:items.$.name--></li></ul></div>"#.to_string(),
      r#"<div><p>No items</p></div>"#.to_string(),
    ];
    let result = extract_template(&axes, &variants);
    // The <ul> should be OUTSIDE the each loop, only <li> inside
    assert!(
      result.contains("<ul") && result.contains("<!--seam:each:items-->"),
      "missing structure in:\n{result}"
    );
    assert!(
      !result.contains("<!--seam:each:items--><ul"),
      "container inside each loop in:\n{result}"
    );
  }
}
