/* packages/server/injector/rust/src/lib.rs */

mod ast;
mod helpers;
mod parser;
mod render;
mod token;

pub use parser::{DiagnosticKind, ParseDiagnostic};

use parser::parse_with_diagnostics;
use render::{inject_attributes, inject_style_attributes, render, RenderContext};
use token::tokenize;

use serde_json::Value;
use std::borrow::Cow;

/// Inject data into template and append __SEAM_DATA__ script before </body>.
pub fn inject(template: &str, data: &Value) -> String {
  let mut result = inject_no_script(template, data);

  // __SEAM_DATA__ script
  let script = format!(r#"<script id="__SEAM_DATA__" type="application/json">{}</script>"#, data);
  if let Some(pos) = result.rfind("</body>") {
    result.insert_str(pos, &script);
  } else {
    result.push_str(&script);
  }

  result
}

/// Inject data into template without appending the __SEAM_DATA__ script.
pub fn inject_no_script(template: &str, data: &Value) -> String {
  inject_no_script_with_diagnostics(template, data).0
}

/// Like `inject_no_script` but also returns parse diagnostics for malformed
/// templates (unmatched block-close, unclosed block-open).
pub fn inject_no_script_with_diagnostics(
  template: &str,
  data: &Value,
) -> (String, Vec<ParseDiagnostic>) {
  // Null-byte marker safety: Phase B uses \x00SEAM_ATTR_N\x00 / \x00SEAM_STYLE_N\x00
  // as deferred attribute-injection placeholders. HTML spec forbids U+0000, so valid
  // templates never contain them. Strip any stray null bytes from malformed SSR output
  // to prevent marker collisions in the find/indexOf lookups.
  let clean: Cow<'_, str> = if template.contains('\0') {
    Cow::Owned(template.replace('\0', ""))
  } else {
    Cow::Borrowed(template)
  };
  let tokens = tokenize(&clean);
  let mut diagnostics = Vec::new();
  let ast = parse_with_diagnostics(&tokens, &mut diagnostics);
  let mut ctx = RenderContext { attrs: Vec::new(), style_attrs: Vec::new() };
  let mut result = render(&ast, data, &mut ctx);

  // Phase B: splice style attributes first
  if !ctx.style_attrs.is_empty() {
    result = inject_style_attributes(result, &ctx.style_attrs);
  }

  // Phase B: splice collected attributes
  if !ctx.attrs.is_empty() {
    result = inject_attributes(result, &ctx.attrs);
  }

  (result, diagnostics)
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;

  // -- Text slots --

  #[test]
  fn text_slot_basic() {
    let html = inject_no_script("<p><!--seam:name--></p>", &json!({"name": "Alice"}));
    assert_eq!(html, "<p>Alice</p>");
  }

  #[test]
  fn text_slot_escapes_html() {
    let html = inject_no_script(
      "<p><!--seam:msg--></p>",
      &json!({"msg": "<script>alert(\"xss\")</script>"}),
    );
    assert_eq!(html, "<p>&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;</p>");
  }

  #[test]
  fn text_slot_nested_path() {
    let html = inject_no_script(
      "<p><!--seam:user.address.city--></p>",
      &json!({"user": {"address": {"city": "Tokyo"}}}),
    );
    assert_eq!(html, "<p>Tokyo</p>");
  }

  #[test]
  fn text_slot_missing_path() {
    let html = inject_no_script("<p><!--seam:missing--></p>", &json!({}));
    assert_eq!(html, "<p></p>");
  }

  #[test]
  fn text_slot_number() {
    let html = inject_no_script("<p><!--seam:count--></p>", &json!({"count": 42}));
    assert_eq!(html, "<p>42</p>");
  }

  // -- Raw HTML --

  #[test]
  fn raw_slot() {
    let html =
      inject_no_script("<div><!--seam:content:html--></div>", &json!({"content": "<b>bold</b>"}));
    assert_eq!(html, "<div><b>bold</b></div>");
  }

  // -- Attribute slots --

  #[test]
  fn attr_slot() {
    let html =
      inject_no_script("<!--seam:cls:attr:class--><div>hi</div>", &json!({"cls": "active"}));
    assert_eq!(html, r#"<div class="active">hi</div>"#);
  }

  #[test]
  fn attr_slot_escapes_value() {
    let html = inject_no_script("<!--seam:v:attr:title--><span>x</span>", &json!({"v": "a\"b"}));
    assert_eq!(html, r#"<span title="a&quot;b">x</span>"#);
  }

  #[test]
  fn attr_slot_missing_skips() {
    let html = inject_no_script("<!--seam:missing:attr:class--><div>hi</div>", &json!({}));
    assert_eq!(html, "<div>hi</div>");
  }

  // -- Conditional --

  #[test]
  fn cond_truthy() {
    let html = inject_no_script(
      "<!--seam:if:show--><p>visible</p><!--seam:endif:show-->",
      &json!({"show": true}),
    );
    assert_eq!(html, "<p>visible</p>");
  }

  #[test]
  fn cond_falsy_bool() {
    let html = inject_no_script(
      "<!--seam:if:show--><p>hidden</p><!--seam:endif:show-->",
      &json!({"show": false}),
    );
    assert_eq!(html, "");
  }

  #[test]
  fn cond_falsy_null() {
    let html = inject_no_script(
      "<!--seam:if:show--><p>hidden</p><!--seam:endif:show-->",
      &json!({"show": null}),
    );
    assert_eq!(html, "");
  }

  #[test]
  fn cond_falsy_zero() {
    let html = inject_no_script(
      "<!--seam:if:count--><p>has</p><!--seam:endif:count-->",
      &json!({"count": 0}),
    );
    assert_eq!(html, "");
  }

  #[test]
  fn cond_falsy_empty_string() {
    let html =
      inject_no_script("<!--seam:if:name--><p>hi</p><!--seam:endif:name-->", &json!({"name": ""}));
    assert_eq!(html, "");
  }

  #[test]
  fn cond_missing_removes() {
    let html =
      inject_no_script("<!--seam:if:missing--><p>gone</p><!--seam:endif:missing-->", &json!({}));
    assert_eq!(html, "");
  }

  #[test]
  fn cond_nested_different_paths() {
    let tmpl = "<!--seam:if:a-->[<!--seam:if:b-->inner<!--seam:endif:b-->]<!--seam:endif:a-->";
    assert_eq!(inject_no_script(tmpl, &json!({"a": true, "b": true})), "[inner]");
    assert_eq!(inject_no_script(tmpl, &json!({"a": true, "b": false})), "[]");
    assert_eq!(inject_no_script(tmpl, &json!({"a": false, "b": true})), "");
  }

  // -- Else branch --

  #[test]
  fn else_truthy() {
    let tmpl = "<!--seam:if:logged-->Hello<!--seam:else-->Guest<!--seam:endif:logged-->";
    assert_eq!(inject_no_script(tmpl, &json!({"logged": true})), "Hello");
  }

  #[test]
  fn else_falsy() {
    let tmpl = "<!--seam:if:logged-->Hello<!--seam:else-->Guest<!--seam:endif:logged-->";
    assert_eq!(inject_no_script(tmpl, &json!({"logged": false})), "Guest");
  }

  #[test]
  fn else_null() {
    let tmpl =
      "<!--seam:if:user--><!--seam:user.name--><!--seam:else-->Anonymous<!--seam:endif:user-->";
    assert_eq!(inject_no_script(tmpl, &json!({"user": null})), "Anonymous");
  }

  #[test]
  fn else_empty_array() {
    let tmpl =
      "<!--seam:if:items--><ul>list</ul><!--seam:else--><p>No items</p><!--seam:endif:items-->";
    assert_eq!(inject_no_script(tmpl, &json!({"items": []})), "<p>No items</p>");
  }

  // -- Each iteration --

  #[test]
  fn each_basic() {
    let tmpl = "<!--seam:each:items--><li><!--seam:$.name--></li><!--seam:endeach-->";
    let data = json!({"items": [{"name": "a"}, {"name": "b"}]});
    assert_eq!(inject_no_script(tmpl, &data), "<li>a</li><li>b</li>");
  }

  #[test]
  fn each_empty() {
    let tmpl = "<!--seam:each:items--><li><!--seam:$.name--></li><!--seam:endeach-->";
    assert_eq!(inject_no_script(tmpl, &json!({"items": []})), "");
  }

  #[test]
  fn each_missing_path() {
    let tmpl = "<!--seam:each:items--><li>x</li><!--seam:endeach-->";
    assert_eq!(inject_no_script(tmpl, &json!({})), "");
  }

  #[test]
  fn each_attr_inside() {
    let tmpl = r#"<!--seam:each:links--><!--seam:$.url:attr:href--><a><!--seam:$.text--></a><!--seam:endeach-->"#;
    let data = json!({"links": [{"url": "/a", "text": "A"}, {"url": "/b", "text": "B"}]});
    assert_eq!(inject_no_script(tmpl, &data), r#"<a href="/a">A</a><a href="/b">B</a>"#);
  }

  #[test]
  fn each_nested_with_double_dollar() {
    let tmpl = concat!(
      "<!--seam:each:groups-->",
      "<h2><!--seam:$.title--></h2>",
      "<!--seam:each:$.items-->",
      "<p><!--seam:$.label--> in <!--seam:$$.title--></p>",
      "<!--seam:endeach-->",
      "<!--seam:endeach-->"
    );
    let data = json!({
      "groups": [
        {"title": "G1", "items": [{"label": "x"}, {"label": "y"}]},
        {"title": "G2", "items": [{"label": "z"}]}
      ]
    });
    assert_eq!(
      inject_no_script(tmpl, &data),
      "<h2>G1</h2><p>x in G1</p><p>y in G1</p><h2>G2</h2><p>z in G2</p>"
    );
  }

  // -- Empty array falsy --

  #[test]
  fn empty_array_falsy_in_if() {
    let tmpl = "<!--seam:if:items-->has<!--seam:endif:items-->";
    assert_eq!(inject_no_script(tmpl, &json!({"items": []})), "");
    assert_eq!(inject_no_script(tmpl, &json!({"items": [1]})), "has");
  }

  // -- If inside each --

  #[test]
  fn if_inside_each() {
    let tmpl = concat!(
      "<!--seam:each:users-->",
      "<!--seam:if:$.active--><b><!--seam:$.name--></b><!--seam:endif:$.active-->",
      "<!--seam:endeach-->"
    );
    let data = json!({
      "users": [
        {"name": "Alice", "active": true},
        {"name": "Bob", "active": false},
        {"name": "Carol", "active": true}
      ]
    });
    assert_eq!(inject_no_script(tmpl, &data), "<b>Alice</b><b>Carol</b>");
  }

  // -- Same-path nested if --

  #[test]
  fn same_path_nested_if() {
    let tmpl = "<!--seam:if:x-->outer[<!--seam:if:x-->inner<!--seam:endif:x-->]<!--seam:endif:x-->";
    assert_eq!(inject_no_script(tmpl, &json!({"x": true})), "outer[inner]");
    assert_eq!(inject_no_script(tmpl, &json!({"x": false})), "");
  }

  // -- Match/when/endmatch --

  #[test]
  fn match_basic_3_branches() {
    let tmpl = concat!(
      "<!--seam:match:role-->",
      "<!--seam:when:admin--><b>Admin</b>",
      "<!--seam:when:member--><i>Member</i>",
      "<!--seam:when:guest--><span>Guest</span>",
      "<!--seam:endmatch-->"
    );
    assert_eq!(inject_no_script(tmpl, &json!({"role": "admin"})), "<b>Admin</b>");
    assert_eq!(inject_no_script(tmpl, &json!({"role": "member"})), "<i>Member</i>");
    assert_eq!(inject_no_script(tmpl, &json!({"role": "guest"})), "<span>Guest</span>");
  }

  #[test]
  fn match_missing_value() {
    let tmpl = concat!(
      "<!--seam:match:role-->",
      "<!--seam:when:admin-->Admin",
      "<!--seam:when:guest-->Guest",
      "<!--seam:endmatch-->"
    );
    assert_eq!(inject_no_script(tmpl, &json!({"role": "unknown"})), "");
  }

  #[test]
  fn match_missing_path() {
    let tmpl =
      concat!("<!--seam:match:role-->", "<!--seam:when:admin-->Admin", "<!--seam:endmatch-->");
    assert_eq!(inject_no_script(tmpl, &json!({})), "");
  }

  #[test]
  fn match_inside_each() {
    let tmpl = concat!(
      "<!--seam:each:items-->",
      "<!--seam:match:$.priority-->",
      "<!--seam:when:high--><b>!</b>",
      "<!--seam:when:low--><span>~</span>",
      "<!--seam:endmatch-->",
      "<!--seam:endeach-->"
    );
    let data = json!({"items": [
      {"priority": "high"},
      {"priority": "low"},
      {"priority": "medium"}
    ]});
    assert_eq!(inject_no_script(tmpl, &data), "<b>!</b><span>~</span>");
  }

  #[test]
  fn match_with_nested_slots() {
    let tmpl = concat!(
      "<!--seam:match:role-->",
      "<!--seam:when:admin--><b><!--seam:name--></b>",
      "<!--seam:when:guest--><span>Guest</span>",
      "<!--seam:endmatch-->"
    );
    assert_eq!(inject_no_script(tmpl, &json!({"role": "admin", "name": "Alice"})), "<b>Alice</b>");
  }

  // -- Data script --

  #[test]
  fn data_script_before_body() {
    let html = inject("<body><p>hi</p></body>", &json!({"x": 1}));
    assert!(html
      .contains(r#"<script id="__SEAM_DATA__" type="application/json">{"x":1}</script></body>"#));
  }

  #[test]
  fn data_script_appended_when_no_body() {
    let html = inject("<p>hi</p>", &json!({"x": 1}));
    assert!(
      html.ends_with(r#"<script id="__SEAM_DATA__" type="application/json">{"x":1}</script>"#)
    );
  }

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
    let html =
      inject_no_script("<!--seam:mt:style:margin-top--><div>text</div>", &json!({"mt": 16}));
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
    let html =
      inject_no_script("<!--seam:mt:style:margin-top--><div>text</div>", &json!({"mt": 16}));
    assert_eq!(html, r#"<div style="margin-top:16px">text</div>"#);
  }

  #[test]
  fn style_unitless() {
    let html =
      inject_no_script("<!--seam:op:style:opacity--><span>text</span>", &json!({"op": 0.5}));
    assert_eq!(html, r#"<span style="opacity:0.5">text</span>"#);
  }

  #[test]
  fn style_zero() {
    let html =
      inject_no_script("<!--seam:mt:style:margin-top--><div>text</div>", &json!({"mt": 0}));
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
}
