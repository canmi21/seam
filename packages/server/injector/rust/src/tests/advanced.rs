/* packages/server/injector/rust/src/tests/advanced.rs */

use super::*;
use serde_json::json;

// -- Diagnostic: boolean HTML attribute handling (#21, #22, #58) --

#[test]
fn attr_boolean_true_produces_empty_value() {
  // #21: disabled={true} should render disabled="" (React behavior), not disabled="true"
  let html = inject_no_script("<!--seam:dis:attr:disabled--><input>", &json!({"dis": true}));
  assert_eq!(html, r#"<input disabled="">"#);
}

#[test]
fn attr_boolean_false_omitted() {
  // #21: disabled={false} should omit the attribute entirely
  let html = inject_no_script("<!--seam:dis:attr:disabled--><input>", &json!({"dis": false}));
  assert_eq!(html, "<input>");
}

#[test]
fn attr_checked_boolean() {
  // #22: checked={true} -> checked=""
  // Attribute injection inserts after tag name, before existing attrs
  let html = inject_no_script(
    "<!--seam:chk:attr:checked--><input type=\"checkbox\">",
    &json!({"chk": true}),
  );
  assert_eq!(html, r#"<input checked="" type="checkbox">"#);
}

#[test]
fn attr_selected_boolean() {
  // #58: selected={true} -> selected=""
  let html =
    inject_no_script("<!--seam:sel:attr:selected--><option>A</option>", &json!({"sel": true}));
  assert_eq!(html, r#"<option selected="">A</option>"#);
}

#[test]
fn attr_data_hyphenated_injection() {
  // Injector handles hyphenated attr names correctly (bug is in slot.rs, not here)
  let html =
    inject_no_script("<!--seam:tid:attr:data-testid--><div>hi</div>", &json!({"tid": "card"}));
  assert_eq!(html, r#"<div data-testid="card">hi</div>"#);
}

#[test]
fn enum_match_already_works() {
  // #37: match/when already works; todo was just missing test config
  let tmpl = concat!(
    "<!--seam:match:status-->",
    "<!--seam:when:active--><span class=\"green\">Active</span>",
    "<!--seam:when:inactive--><span class=\"gray\">Inactive</span>",
    "<!--seam:when:pending--><span class=\"yellow\">Pending</span>",
    "<!--seam:endmatch-->"
  );
  assert_eq!(
    inject_no_script(tmpl, &json!({"status": "active"})),
    r#"<span class="green">Active</span>"#
  );
  assert_eq!(
    inject_no_script(tmpl, &json!({"status": "inactive"})),
    r#"<span class="gray">Inactive</span>"#
  );
  assert_eq!(
    inject_no_script(tmpl, &json!({"status": "pending"})),
    r#"<span class="yellow">Pending</span>"#
  );
}

// -- Style property slots --

#[test]
fn style_single_prop() {
  let html = inject_no_script("<!--seam:mt:style:margin-top--><div>text</div>", &json!({"mt": 16}));
  assert_eq!(html, r#"<div style="margin-top:16px">text</div>"#);
}

#[test]
fn style_multiple_props() {
  let html = inject_no_script(
    "<!--seam:mt:style:margin-top--><!--seam:fs:style:font-size--><div>text</div>",
    &json!({"mt": 16, "fs": 14}),
  );
  assert_eq!(html, r#"<div style="margin-top:16px;font-size:14px">text</div>"#);
}

#[test]
fn style_number_px() {
  let html = inject_no_script("<!--seam:mt:style:margin-top--><div>text</div>", &json!({"mt": 16}));
  assert_eq!(html, r#"<div style="margin-top:16px">text</div>"#);
}

#[test]
fn style_unitless() {
  let html = inject_no_script("<!--seam:op:style:opacity--><span>text</span>", &json!({"op": 0.5}));
  assert_eq!(html, r#"<span style="opacity:0.5">text</span>"#);
}

#[test]
fn style_zero() {
  let html = inject_no_script("<!--seam:mt:style:margin-top--><div>text</div>", &json!({"mt": 0}));
  assert_eq!(html, r#"<div style="margin-top:0">text</div>"#);
}

#[test]
fn style_null_skipped() {
  let html =
    inject_no_script("<!--seam:mt:style:margin-top--><div>text</div>", &json!({"mt": null}));
  assert_eq!(html, "<div>text</div>");
}

#[test]
fn style_false_skipped() {
  let html =
    inject_no_script("<!--seam:mt:style:margin-top--><div>text</div>", &json!({"mt": false}));
  assert_eq!(html, "<div>text</div>");
}

#[test]
fn style_merge_with_existing() {
  let html = inject_no_script(
    r#"<!--seam:mt:style:margin-top--><div style="color:red">text</div>"#,
    &json!({"mt": 16}),
  );
  assert_eq!(html, r#"<div style="color:red;margin-top:16px">text</div>"#);
}

#[test]
fn style_string_value() {
  let html = inject_no_script("<!--seam:c:style:color--><div>text</div>", &json!({"c": "blue"}));
  assert_eq!(html, r#"<div style="color:blue">text</div>"#);
}

// -- Float-hoisted metadata --

#[test]
fn float_title_text() {
  let html = inject_no_script("<title><!--seam:t--></title>", &json!({"t": "My Page"}));
  assert_eq!(html, "<title>My Page</title>");
}

#[test]
fn float_meta_attr() {
  let html = inject_no_script(
    r#"<!--seam:d:attr:content--><meta name="description">"#,
    &json!({"d": "A description"}),
  );
  assert_eq!(html, r#"<meta content="A description" name="description">"#);
}

#[test]
fn float_link_attr() {
  let html = inject_no_script(
    r#"<!--seam:u:attr:href--><link rel="canonical">"#,
    &json!({"u": "https://example.com"}),
  );
  assert_eq!(html, r#"<link href="https://example.com" rel="canonical">"#);
}

#[test]
fn float_dual_attrs_on_meta() {
  let html = inject_no_script(
    r#"<!--seam:a:attr:property--><!--seam:b:attr:content--><meta name="og">"#,
    &json!({"a": "og:title", "b": "My Page"}),
  );
  assert_eq!(html, r#"<meta property="og:title" content="My Page" name="og">"#);
}

// -- HTML slot no escape --

#[test]
fn html_slot_no_escape() {
  let html =
    inject_no_script("<div><!--seam:content:html--></div>", &json!({"content": "<b>bold</b>"}));
  assert_eq!(html, "<div><b>bold</b></div>");
}

// -- Each with non-array value --

#[test]
fn each_non_array_value() {
  // Object value (not array) should produce empty output
  let tmpl = "<!--seam:each:items--><li><!--seam:$.x--></li><!--seam:endeach-->";
  let html = inject_no_script(tmpl, &json!({"items": {"x": 1}}));
  assert_eq!(html, "");
}

// -- Match with numeric value --

#[test]
fn match_numeric_value() {
  let tmpl = concat!(
    "<!--seam:match:code-->",
    "<!--seam:when:200-->OK",
    "<!--seam:when:404-->Not Found",
    "<!--seam:endmatch-->"
  );
  let html = inject_no_script(tmpl, &json!({"code": 200}));
  assert_eq!(html, "OK");
}

// -- Non-boolean attr with null value --

#[test]
fn non_boolean_attr_null_value() {
  // null value should cause attribute to be omitted (resolve returns Some(&Null),
  // but stringify produces empty string which still gets injected)
  let html = inject_no_script("<!--seam:v:attr:class--><div>hi</div>", &json!({"v": null}));
  assert_eq!(html, r#"<div class="">hi</div>"#);
}

// -- Null-byte safety --

#[test]
fn null_byte_in_template_stripped() {
  // Null bytes near seam directives should be stripped, leaving injection intact
  let html = inject_no_script("<p>\x00<!--seam:name-->\x00</p>", &json!({"name": "Alice"}));
  assert_eq!(html, "<p>Alice</p>");
}

#[test]
fn null_byte_in_attr_template_stripped() {
  let html =
    inject_no_script("\x00<!--seam:cls:attr:class--><div>hi</div>", &json!({"cls": "active"}));
  assert_eq!(html, r#"<div class="active">hi</div>"#);
}

#[test]
fn float_full_document() {
  let tmpl = concat!(
    r#"<!DOCTYPE html><html><head><meta charset="utf-8">"#,
    "<title><!--seam:t--></title>",
    r#"<!--seam:d:attr:content--><meta name="description">"#,
    r#"<link rel="stylesheet" href="/_seam/static/style.css">"#,
    r#"</head><body><div id="__seam">"#,
    "<p><!--seam:body--></p>",
    "</div></body></html>",
  );
  let data = json!({"t": "Home", "d": "Welcome page", "body": "Hello world"});
  let html = inject(tmpl, &data);

  // <head> section has injected values
  let head = html.split("</head>").next().unwrap();
  assert!(head.contains("style.css"));
  assert!(head.contains("<title>Home</title>"), "injected title in <head>");
  assert!(head.contains(r#"content="Welcome page""#), "injected meta in <head>");

  // Content injected correctly
  assert!(html.contains("<p>Hello world</p>"));

  // __SEAM_DATA__ script lands before </body>
  assert!(html.contains(r#"<script id="__SEAM_DATA__" type="application/json">"#));
  let body_end = html.rfind("</body>").unwrap();
  let script_end = html.rfind("</script>").unwrap();
  assert!(script_end < body_end);
}

// -- Diagnostics integration --

#[test]
fn diagnostics_on_malformed_template() {
  // Orphan endif + unclosed if via typo
  let tmpl = "<!--seam:if:show--><p>hi</p><!--seam:endif:shwo-->";
  let (_, diags) = inject_no_script_with_diagnostics(tmpl, &json!({"show": true}));
  assert!(!diags.is_empty());
  let kinds: Vec<_> = diags.iter().map(|d| &d.kind).collect();
  assert!(kinds.contains(&&DiagnosticKind::UnmatchedBlockClose));
  assert!(kinds.contains(&&DiagnosticKind::UnclosedBlock));
}

#[test]
fn malformed_template_still_renders() {
  // Even with diagnostics, valid parts render correctly
  let tmpl = "<h1><!--seam:title--></h1><!--seam:endif:orphan--><p>ok</p>";
  let (html, diags) = inject_no_script_with_diagnostics(tmpl, &json!({"title": "Hello"}));
  assert_eq!(html, "<h1>Hello</h1><p>ok</p>");
  assert_eq!(diags.len(), 1);
  assert_eq!(diags[0].kind, DiagnosticKind::UnmatchedBlockClose);
}
