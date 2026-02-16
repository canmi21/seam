/* packages/cli/core/src/build/skeleton/extract/mod.rs */

mod array;
mod boolean;
mod combo;
mod container;
mod dom;
mod enum_axis;
mod tree_diff;
mod variant;

use std::collections::HashSet;

use super::Axis;
use array::{process_array, process_array_with_children};
use boolean::process_boolean;
use combo::classify_axes;
use dom::{parse_html, serialize, DomNode};
use enum_axis::process_enum;

// -- Shared helpers (used by boolean, enum_axis, array sub-modules via super::) --

/// True if a Comment node is a seam directive (if/else/endif/each/match/when/...).
fn is_directive_comment(node: &DomNode) -> bool {
  match node {
    DomNode::Comment(c) => {
      c.starts_with("seam:if:")
        || c.starts_with("seam:endif:")
        || c == "seam:else"
        || c.starts_with("seam:each:")
        || c == "seam:endeach"
        || c.starts_with("seam:match:")
        || c.starts_with("seam:when:")
        || c == "seam:endmatch"
    }
    _ => false,
  }
}

/// Map content nodes in a tree (skipping directive comments) to tree indices.
/// Returns a vec where content_map[k] = index in `tree` of the k-th content node.
fn content_indices(tree: &[DomNode]) -> Vec<usize> {
  tree.iter().enumerate().filter(|(_, n)| !is_directive_comment(n)).map(|(i, _)| i).collect()
}

/// Find the tree index of the n-th non-directive node.
fn nth_content_index(tree: &[DomNode], n: usize) -> Option<usize> {
  tree.iter().enumerate().filter(|(_, n)| !is_directive_comment(n)).nth(n).map(|(i, _)| i)
}

/// Rename seam slot markers in a tree: `<!--seam:prefix.x-->` → `<!--seam:x-->`
fn rename_slot_markers(nodes: &mut [DomNode], prefix: &str) {
  let old = format!("seam:{prefix}.");
  for node in nodes.iter_mut() {
    match node {
      DomNode::Comment(c) if c.starts_with(&old) => {
        *c = format!("seam:{}", &c[old.len()..]);
      }
      DomNode::Element { children, .. } => rename_slot_markers(children, prefix),
      _ => {}
    }
  }
}

/// Navigate into a tree following a path of child indices.
fn navigate_to_children<'a>(nodes: &'a [DomNode], path: &[usize]) -> &'a [DomNode] {
  if path.is_empty() {
    return nodes;
  }
  match &nodes[path[0]] {
    DomNode::Element { children, .. } => navigate_to_children(children, &path[1..]),
    _ => nodes,
  }
}

// -- Orchestrator --

/// Core recursive extraction engine.
fn extract_template_inner(axes: &[Axis], variants: &[String]) -> String {
  if variants.is_empty() {
    return String::new();
  }
  if variants.len() == 1 || axes.is_empty() {
    return variants[0].clone();
  }

  let mut result = parse_html(&variants[0]);

  // 1. Classify axes into top-level and nested groups
  let (top_level, groups) = classify_axes(axes);

  // 2. Track axes handled by groups (parent + all children)
  let mut handled: HashSet<usize> = HashSet::new();
  for group in &groups {
    handled.insert(group.parent_axis_idx);
    for &child in &group.children {
      handled.insert(child);
    }
    result = process_array_with_children(result, axes, variants, group);
  }

  // 3. Process remaining top-level axes not owned by any group
  for &idx in &top_level {
    if handled.contains(&idx) {
      continue;
    }
    let axis = &axes[idx];
    result = match axis.kind.as_str() {
      "boolean" | "nullable" => process_boolean(result, axes, variants, idx),
      "enum" => {
        let (new_result, consumed_siblings) = process_enum(result, axes, variants, idx);
        if consumed_siblings {
          // All sibling axes were recursively processed inside each enum arm,
          // so mark them handled to prevent doubled directives.
          for &other in &top_level {
            if other != idx {
              handled.insert(other);
            }
          }
        }
        new_result
      }
      "array" => process_array(result, axes, variants, idx),
      _ => result,
    };
  }

  serialize(&result)
}

/// Extract a complete Slot Protocol v2 template from variant HTML strings.
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
    assert!(result.contains("<!--seam:if:isAdmin-->"), "missing if in: {result}");
    assert!(result.contains("<span>Admin</span>"), "missing Admin in: {result}");
    assert!(result.contains("<!--seam:endif:isAdmin-->"), "missing endif in: {result}");
  }

  #[test]
  fn extract_boolean_if_else() {
    let axes = vec![make_axis("isLoggedIn", "boolean", vec![json!(true), json!(false)])];
    let variants =
      vec!["<div><b>Welcome</b></div>".to_string(), "<div><i>Login</i></div>".to_string()];
    let result = extract_template(&axes, &variants);
    assert!(result.contains("<!--seam:if:isLoggedIn-->"), "missing if in: {result}");
    assert!(result.contains("<b>Welcome</b>"), "missing Welcome in: {result}");
    assert!(result.contains("<!--seam:else-->"), "missing else in: {result}");
    assert!(result.contains("<i>Login</i>"), "missing Login in: {result}");
    assert!(result.contains("<!--seam:endif:isLoggedIn-->"), "missing endif in: {result}");
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
    assert!(result.contains("<!--seam:match:role-->"), "missing match in: {result}");
    assert!(result.contains("<!--seam:when:admin-->"), "missing when:admin in: {result}");
    assert!(result.contains("<!--seam:when:member-->"), "missing when:member in: {result}");
    assert!(result.contains("<!--seam:when:guest-->"), "missing when:guest in: {result}");
    assert!(result.contains("<!--seam:endmatch-->"), "missing endmatch in: {result}");
  }

  #[test]
  fn extract_array_each() {
    let axes = vec![make_axis("posts", "array", vec![json!("populated"), json!("empty")])];
    let variants =
      vec!["<ul><li><!--seam:posts.$.name--></li></ul>".to_string(), "<ul></ul>".to_string()];
    let result = extract_template(&axes, &variants);
    assert!(result.contains("<!--seam:each:posts-->"), "missing each in: {result}");
    assert!(result.contains("<!--seam:$.name-->"), "missing $.name in: {result}");
    assert!(result.contains("<!--seam:endeach-->"), "missing endeach in: {result}");
    assert!(!result.contains("posts.$.name"), "leaked full path in: {result}");
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

    fn gen(is_admin: bool, posts_pop: bool, has_image: bool, has_caption: bool) -> String {
      let admin = if is_admin { "<b>Admin</b>" } else { "" };
      let img = if has_image { "<img/>" } else { "" };
      let cap = if has_caption { "<em>Cap</em>" } else { "" };
      let items = if posts_pop { format!("<li>Post{img}{cap}</li>") } else { String::new() };
      format!("<div>{admin}<ul>{items}</ul></div>")
    }

    let variants = vec![
      gen(true, true, true, true),
      gen(true, true, true, false),
      gen(true, true, false, true),
      gen(true, true, false, false),
      gen(true, false, true, true),
      gen(true, false, true, false),
      gen(true, false, false, true),
      gen(true, false, false, false),
      gen(false, true, true, true),
      gen(false, true, true, false),
      gen(false, true, false, true),
      gen(false, true, false, false),
      gen(false, false, true, true),
      gen(false, false, true, false),
      gen(false, false, false, true),
      gen(false, false, false, false),
    ];

    let result = extract_template(&axes, &variants);

    assert!(result.contains("<!--seam:if:isAdmin-->"), "missing if:isAdmin in: {result}");
    assert!(result.contains("<b>Admin</b>"), "missing Admin block in: {result}");
    assert!(result.contains("<!--seam:endif:isAdmin-->"), "missing endif:isAdmin in: {result}");
    assert!(result.contains("<!--seam:each:posts-->"), "missing each:posts in: {result}");
    assert!(result.contains("<!--seam:endeach-->"), "missing endeach in: {result}");
    assert!(result.contains("<!--seam:if:$.hasImage-->"), "missing if:$.hasImage in: {result}");
    assert!(result.contains("<img/>"), "missing img in: {result}");
    assert!(
      result.contains("<!--seam:endif:$.hasImage-->"),
      "missing endif:$.hasImage in: {result}"
    );
    assert!(result.contains("<!--seam:if:$.caption-->"), "missing if:$.caption in: {result}");
    assert!(result.contains("<em>Cap</em>"), "missing Cap block in: {result}");
    assert!(result.contains("<!--seam:endif:$.caption-->"), "missing endif:$.caption in: {result}");
    assert!(!result.contains("posts.$."), "leaked nested path in: {result}");
  }

  #[test]
  fn extract_array_without_children_unchanged() {
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

    // Bug 1: <ul> must NOT be inside the each loop
    assert!(
      !result.contains("<!--seam:each:posts--><ul"),
      "Bug 1: container duplicated inside each loop in:\n{result}"
    );

    // Bug 2: all seam comments must be well-formed
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
  fn extract_array_with_all_child_types() {
    // Full home page scenario: top-level axes + posts array with 4 child axis types.
    let axes = vec![
      make_axis("isAdmin", "boolean", vec![json!(true), json!(false)]),
      make_axis("isLoggedIn", "boolean", vec![json!(true), json!(false)]),
      make_axis("subtitle", "nullable", vec![json!("present"), json!(null)]),
      make_axis("role", "enum", vec![json!("admin"), json!("member"), json!("guest")]),
      make_axis("posts", "array", vec![json!("populated"), json!("empty")]),
      make_axis("posts.$.isPublished", "boolean", vec![json!(true), json!(false)]),
      make_axis("posts.$.priority", "enum", vec![json!("high"), json!("medium"), json!("low")]),
      make_axis("posts.$.author", "nullable", vec![json!("present"), json!(null)]),
      make_axis("posts.$.tags", "array", vec![json!("populated"), json!("empty")]),
    ];

    #[allow(clippy::too_many_arguments)]
    fn gen(
      is_admin: bool,
      is_logged_in: bool,
      subtitle: bool,
      role: &str,
      pop: bool,
      published: bool,
      priority: &str,
      author: bool,
      tags: bool,
    ) -> String {
      let admin = if is_admin { "<span>Admin</span>" } else { "" };
      let status = if is_logged_in { "Signed in" } else { "Please sign in" };
      let sub = if subtitle { "<p><!--seam:subtitle--></p>" } else { "" };
      let role_html = match role {
        "admin" => "<span>Full access</span>",
        "member" => "<span>Member access</span>",
        _ => "<span>Read-only</span>",
      };
      let posts_html = if pop {
        let pub_html = if published { "<span>Published</span>" } else { "<span>Draft</span>" };
        let border = match priority {
          "high" => "border-red",
          "medium" => "border-amber",
          _ => "border-gray",
        };
        let author_html = if author { "<span>by <!--seam:posts.$.author--></span>" } else { "" };
        let tags_html = if tags { "<span><!--seam:posts.$.tags.$.name--></span>" } else { "" };
        format!(
          r#"<ul class="list"><li class="{border}"><!--seam:posts.$.title-->{pub_html}{author_html}<div>{tags_html}</div></li></ul>"#
        )
      } else {
        "<p>No posts</p>".to_string()
      };
      format!("<div>{admin}<p>{status}</p>{sub}{role_html}{posts_html}</div>")
    }

    let mut variants = Vec::new();
    for &is_admin in &[true, false] {
      for &is_logged_in in &[true, false] {
        for &subtitle in &[true, false] {
          for role in &["admin", "member", "guest"] {
            for &pop in &[true, false] {
              for &published in &[true, false] {
                for priority in &["high", "medium", "low"] {
                  for &author in &[true, false] {
                    for &tags in &[true, false] {
                      variants.push(gen(
                        is_admin,
                        is_logged_in,
                        subtitle,
                        role,
                        pop,
                        published,
                        priority,
                        author,
                        tags,
                      ));
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    assert_eq!(variants.len(), 1152);
    let result = extract_template(&axes, &variants);

    // Container unwrap: <ul> must be OUTSIDE the each loop
    assert!(
      !result.contains("<!--seam:each:posts--><ul"),
      "container duplicated inside each loop in:\n{result}"
    );
    assert!(
      result.contains("<ul") && result.contains("<!--seam:each:posts-->"),
      "missing structure in:\n{result}"
    );
    // Top-level directives
    assert!(result.contains("<!--seam:if:isAdmin-->"), "missing isAdmin in:\n{result}");
    assert!(result.contains("<!--seam:if:isLoggedIn-->"), "missing isLoggedIn in:\n{result}");
    assert!(result.contains("<!--seam:if:subtitle-->"), "missing subtitle in:\n{result}");
    assert!(result.contains("<!--seam:match:role-->"), "missing role match in:\n{result}");
    // Nested directives
    assert!(result.contains("<!--seam:if:$.isPublished-->"), "missing isPublished in:\n{result}");
    assert!(
      result.contains("<!--seam:match:$.priority-->"),
      "missing priority match in:\n{result}"
    );
    assert!(result.contains("<!--seam:if:$.author-->"), "missing author conditional in:\n{result}");
    assert!(result.contains("<!--seam:each:$.tags-->"), "missing tags each in:\n{result}");
    assert!(result.contains("<!--seam:endeach-->"), "missing endeach in:\n{result}");
    assert!(!result.contains("posts.$."), "leaked nested path in:\n{result}");

    // No doubled directives: role wraps everything (3 arms), $.priority inside each (3 arms).
    // Nested directives appear 3 × 3 = 9 times; top-level ones appear 3 times (once per role arm).
    assert_eq!(
      result.matches("<!--seam:each:$.tags-->").count(),
      9,
      "wrong each:$.tags count in:\n{result}"
    );
    assert_eq!(
      result.matches("<!--seam:if:$.author-->").count(),
      9,
      "wrong if:$.author count in:\n{result}"
    );
    assert_eq!(
      result.matches("<!--seam:if:subtitle-->").count(),
      3,
      "wrong if:subtitle count in:\n{result}"
    );
  }

  #[test]
  fn extract_boolean_if_else_in_class_attribute() {
    let axes = vec![make_axis("dark", "boolean", vec![json!(true), json!(false)])];
    let variants = vec![
      r#"<div class="bg-black text-white">Dark</div>"#.to_string(),
      r#"<div class="bg-white text-black">Light</div>"#.to_string(),
    ];
    let result = extract_template(&axes, &variants);
    assert!(
      !result.contains(r#"class=""#) || !result.contains("<!--seam:if:dark-->text-"),
      "diff boundary inside class attribute in:\n{result}"
    );
    assert!(result.contains("<!--seam:if:dark-->"), "missing if in:\n{result}");
    assert!(result.contains("<!--seam:else-->"), "missing else in:\n{result}");
    assert!(result.contains("<!--seam:endif:dark-->"), "missing endif in:\n{result}");
  }

  #[test]
  fn extract_array_container_unwrap() {
    let axes = vec![make_axis("items", "array", vec![json!("populated"), json!("empty")])];
    let variants = vec![
      r#"<div><ul class="list"><li><!--seam:items.$.name--></li></ul></div>"#.to_string(),
      r#"<div><p>No items</p></div>"#.to_string(),
    ];
    let result = extract_template(&axes, &variants);
    assert!(
      result.contains("<ul") && result.contains("<!--seam:each:items-->"),
      "missing structure in:\n{result}"
    );
    assert!(
      !result.contains("<!--seam:each:items--><ul"),
      "container inside each loop in:\n{result}"
    );
  }

  // -- Motivating bug: sibling boolean conditionals --

  #[test]
  fn extract_sibling_booleans() {
    let axes = vec![
      make_axis("isAdmin", "boolean", vec![json!(true), json!(false)]),
      make_axis("isLoggedIn", "boolean", vec![json!(true), json!(false)]),
    ];
    let variants = vec![
      "<div><span>Admin</span><span>Welcome</span></div>".into(), // TT
      "<div><span>Admin</span></div>".into(),                     // TF
      "<div><span>Welcome</span></div>".into(),                   // FT
      "<div></div>".into(),                                       // FF
    ];
    let result = extract_template(&axes, &variants);
    assert!(
      result.contains("<!--seam:if:isAdmin--><span>Admin</span><!--seam:endif:isAdmin-->"),
      "missing isAdmin conditional in:\n{result}"
    );
    assert!(
      result.contains("<!--seam:if:isLoggedIn--><span>Welcome</span><!--seam:endif:isLoggedIn-->"),
      "missing isLoggedIn conditional in:\n{result}"
    );
  }
}
