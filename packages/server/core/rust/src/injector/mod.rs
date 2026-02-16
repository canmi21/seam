/* packages/server/core/rust/src/injector/mod.rs */

mod ast;
mod helpers;
mod parser;
mod render;
mod token;

use parser::parse;
use render::{inject_attributes, render, RenderContext};
use token::tokenize;

use serde_json::Value;

pub fn inject(template: &str, data: &Value) -> String {
  let tokens = tokenize(template);
  let ast = parse(&tokens);
  let mut ctx = RenderContext { attrs: Vec::new() };
  let mut result = render(&ast, data, &mut ctx);

  // Phase B: splice collected attributes
  if !ctx.attrs.is_empty() {
    result = inject_attributes(result, &ctx.attrs);
  }

  // __SEAM_DATA__ script
  let script = format!(r#"<script id="__SEAM_DATA__" type="application/json">{}</script>"#, data);
  if let Some(pos) = result.rfind("</body>") {
    result.insert_str(pos, &script);
  } else {
    result.push_str(&script);
  }

  result
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::json;

  // Helper: inject without data script for cleaner assertions
  fn inject_no_script(template: &str, data: &Value) -> String {
    let tokens = tokenize(template);
    let ast = parse(&tokens);
    let mut ctx = RenderContext { attrs: Vec::new() };
    let mut result = render(&ast, data, &mut ctx);
    if !ctx.attrs.is_empty() {
      result = inject_attributes(result, &ctx.attrs);
    }
    result
  }

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
}
