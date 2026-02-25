/* packages/cli/core/src/build/skeleton/extract/tests/legacy.rs */

// Legacy v1 helpers and their tests (kept for regression coverage)

// -- Legacy v1 helpers (test-only, kept for regression coverage) --

fn detect_conditional(full_html: &str, nulled_html: &str, field: &str) -> Option<ConditionalBlock> {
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
  let prefix_len = full_html.bytes().zip(emptied_html.bytes()).take_while(|(a, b)| a == b).count();
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
