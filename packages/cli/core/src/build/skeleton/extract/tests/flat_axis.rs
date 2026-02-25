/* packages/cli/core/src/build/skeleton/extract/tests/flat_axis.rs */

// Flat axis tests: single-level axis extraction with basic directives.

use super::*;

// -- extract_template: array empty-state fallback tests --

#[test]
fn extract_array_with_empty_fallback() {
  // Flat array where empty variant has completely different content (not just empty container)
  let axes = vec![make_axis("items", "array", vec![json!("populated"), json!("empty")])];
  let variants =
    vec!["<li><!--seam:items.$.name--></li>".to_string(), "<p>No items</p>".to_string()];
  let result = extract_template(&axes, &variants);
  assert!(result.contains("<!--seam:if:items-->"), "missing if:items in:\n{result}");
  assert!(result.contains("<!--seam:each:items-->"), "missing each:items in:\n{result}");
  assert!(result.contains("<!--seam:$.name-->"), "missing $.name in:\n{result}");
  assert!(result.contains("<!--seam:endeach-->"), "missing endeach in:\n{result}");
  assert!(result.contains("<!--seam:else-->"), "missing else in:\n{result}");
  assert!(result.contains("<p>No items</p>"), "missing fallback in:\n{result}");
  assert!(result.contains("<!--seam:endif:items-->"), "missing endif:items in:\n{result}");
}

#[test]
fn extract_array_with_empty_fallback_nested() {
  // Array inside a shared parent <div> -- exercises Modified -> recurse -> OnlyLeft+OnlyRight
  let axes = vec![make_axis("items", "array", vec![json!("populated"), json!("empty")])];
  let variants = vec![
    "<div><ul><li><!--seam:items.$.name--></li></ul></div>".to_string(),
    "<div><p>No items yet</p></div>".to_string(),
  ];
  let result = extract_template(&axes, &variants);
  assert!(result.contains("<!--seam:if:items-->"), "missing if:items in:\n{result}");
  assert!(result.contains("<!--seam:each:items-->"), "missing each:items in:\n{result}");
  assert!(result.contains("<!--seam:endeach-->"), "missing endeach in:\n{result}");
  assert!(result.contains("<!--seam:else-->"), "missing else in:\n{result}");
  assert!(result.contains("<p>No items yet</p>"), "missing fallback in:\n{result}");
  assert!(result.contains("<!--seam:endif:items-->"), "missing endif:items in:\n{result}");
}

#[test]
fn extract_array_with_children_and_fallback() {
  // Array with nested child axis AND empty state fallback
  let axes = vec![
    make_axis("posts", "array", vec![json!("populated"), json!("empty")]),
    make_axis("posts.$.hasAuthor", "boolean", vec![json!(true), json!(false)]),
  ];
  let variants = vec![
    "<div><ul><li>Title<span>Author</span></li></ul></div>".to_string(),
    "<div><ul><li>Title</li></ul></div>".to_string(),
    "<div><p>No posts</p></div>".to_string(),
    "<div><p>No posts</p></div>".to_string(),
  ];
  let result = extract_template(&axes, &variants);
  assert!(result.contains("<!--seam:if:posts-->"), "missing if:posts in:\n{result}");
  assert!(result.contains("<!--seam:each:posts-->"), "missing each:posts in:\n{result}");
  assert!(result.contains("<!--seam:if:$.hasAuthor-->"), "missing if:$.hasAuthor in:\n{result}");
  assert!(result.contains("<span>Author</span>"), "missing Author in:\n{result}");
  assert!(result.contains("<!--seam:endif:$.hasAuthor-->"), "missing endif in:\n{result}");
  assert!(result.contains("<!--seam:endeach-->"), "missing endeach in:\n{result}");
  assert!(result.contains("<!--seam:else-->"), "missing else in:\n{result}");
  assert!(result.contains("<p>No posts</p>"), "missing fallback in:\n{result}");
  assert!(result.contains("<!--seam:endif:posts-->"), "missing endif:posts in:\n{result}");
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
  let axes = vec![make_axis("role", "enum", vec![json!("admin"), json!("member"), json!("guest")])];
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
  assert!(result.contains("<!--seam:endif:$.hasImage-->"), "missing endif:$.hasImage in: {result}");
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
