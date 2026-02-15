/* packages/server/core/rust/src/injector.rs */

use serde_json::Value;

// -- AST node types --

#[derive(Debug)]
enum AstNode {
  Text(String),
  Slot { path: String, mode: SlotMode },
  Attr { path: String, attr_name: String },
  If { path: String, then_nodes: Vec<AstNode>, else_nodes: Vec<AstNode> },
  Each { path: String, body_nodes: Vec<AstNode> },
  Match { path: String, branches: Vec<(String, Vec<AstNode>)> },
}

#[derive(Debug)]
enum SlotMode {
  Text,
  Html,
}

// -- Tokenizer --

#[derive(Debug)]
enum Token {
  Text(String),
  Marker(String), // directive body (between <!--seam: and -->)
}

const MARKER_OPEN: &str = "<!--seam:";
const MARKER_CLOSE: &str = "-->";

fn tokenize(template: &str) -> Vec<Token> {
  let mut tokens = Vec::new();
  let mut pos = 0;
  let bytes = template.as_bytes();

  while pos < bytes.len() {
    if let Some(rel) = template[pos..].find(MARKER_OPEN) {
      let marker_start = pos + rel;
      if marker_start > pos {
        tokens.push(Token::Text(template[pos..marker_start].to_string()));
      }
      let after_open = marker_start + MARKER_OPEN.len();
      if let Some(close_rel) = template[after_open..].find(MARKER_CLOSE) {
        let directive = template[after_open..after_open + close_rel].to_string();
        tokens.push(Token::Marker(directive));
        pos = after_open + close_rel + MARKER_CLOSE.len();
      } else {
        // Unclosed marker -- treat rest as text
        tokens.push(Token::Text(template[marker_start..].to_string()));
        break;
      }
    } else {
      tokens.push(Token::Text(template[pos..].to_string()));
      break;
    }
  }

  tokens
}

// -- Parser --

fn parse(tokens: &[Token]) -> Vec<AstNode> {
  let mut pos = 0;
  parse_until(tokens, &mut pos, &|_| false)
}

fn parse_until(
  tokens: &[Token],
  pos: &mut usize,
  stop: &dyn Fn(&str) -> bool,
) -> Vec<AstNode> {
  let mut nodes = Vec::new();

  while *pos < tokens.len() {
    match &tokens[*pos] {
      Token::Text(value) => {
        nodes.push(AstNode::Text(value.clone()));
        *pos += 1;
      }
      Token::Marker(directive) => {
        if stop(directive) {
          return nodes;
        }

        if let Some(path) = directive.strip_prefix("match:") {
          let path = path.to_string();
          *pos += 1;
          let mut branches: Vec<(String, Vec<AstNode>)> = Vec::new();
          while *pos < tokens.len() {
            if let Token::Marker(d) = &tokens[*pos] {
              if d == "endmatch" {
                *pos += 1;
                break;
              }
              if let Some(value) = d.strip_prefix("when:") {
                let value = value.to_string();
                *pos += 1;
                let body = parse_until(tokens, pos, &|d| d.starts_with("when:") || d == "endmatch");
                branches.push((value, body));
              } else {
                // Skip unexpected tokens between match and first when
                *pos += 1;
              }
            } else {
              *pos += 1;
            }
          }
          nodes.push(AstNode::Match { path, branches });
        } else if let Some(path) = directive.strip_prefix("if:") {
          let path = path.to_string();
          *pos += 1;
          let endif_tag = format!("endif:{path}");
          let then_nodes = parse_until(tokens, pos, &|d| d == "else" || d == endif_tag);

          let else_nodes = if *pos < tokens.len() {
            if let Token::Marker(d) = &tokens[*pos] {
              if d == "else" {
                *pos += 1;
                parse_until(tokens, pos, &|d| d == endif_tag)
              } else {
                Vec::new()
              }
            } else {
              Vec::new()
            }
          } else {
            Vec::new()
          };

          // Skip endif token
          if *pos < tokens.len() {
            *pos += 1;
          }
          nodes.push(AstNode::If { path, then_nodes, else_nodes });
        } else if let Some(path) = directive.strip_prefix("each:") {
          let path = path.to_string();
          *pos += 1;
          let body_nodes = parse_until(tokens, pos, &|d| d == "endeach");
          // Skip endeach token
          if *pos < tokens.len() {
            *pos += 1;
          }
          nodes.push(AstNode::Each { path, body_nodes });
        } else if let Some(rest) = directive.find(":attr:") {
          let path = directive[..rest].to_string();
          let attr_name = directive[rest + 6..].to_string();
          *pos += 1;
          nodes.push(AstNode::Attr { path, attr_name });
        } else if let Some(path) = directive.strip_suffix(":html") {
          *pos += 1;
          nodes.push(AstNode::Slot { path: path.to_string(), mode: SlotMode::Html });
        } else {
          // Plain text slot
          let path = directive.clone();
          *pos += 1;
          nodes.push(AstNode::Slot { path, mode: SlotMode::Text });
        }
      }
    }
  }

  nodes
}

// -- Resolve --

fn resolve<'a>(path: &str, data: &'a Value) -> Option<&'a Value> {
  let mut current = data;
  for key in path.split('.') {
    current = current.get(key)?;
  }
  Some(current)
}

// -- Truthiness --

fn is_truthy(value: &Value) -> bool {
  match value {
    Value::Null => false,
    Value::Bool(b) => *b,
    Value::Number(n) => {
      if let Some(i) = n.as_i64() {
        i != 0
      } else if let Some(f) = n.as_f64() {
        f != 0.0
      } else {
        true
      }
    }
    Value::String(s) => !s.is_empty(),
    Value::Array(arr) => !arr.is_empty(),
    Value::Object(_) => true,
  }
}

// -- Stringify --

fn stringify(value: &Value) -> String {
  match value {
    Value::Null => String::new(),
    Value::Bool(b) => b.to_string(),
    Value::Number(n) => n.to_string(),
    Value::String(s) => s.clone(),
    other => other.to_string(),
  }
}

// -- Escape --

fn escape_html(s: &str) -> String {
  let mut out = String::with_capacity(s.len());
  for ch in s.chars() {
    match ch {
      '&' => out.push_str("&amp;"),
      '<' => out.push_str("&lt;"),
      '>' => out.push_str("&gt;"),
      '"' => out.push_str("&quot;"),
      '\'' => out.push_str("&#x27;"),
      c => out.push(c),
    }
  }
  out
}

// -- Renderer --

struct AttrEntry {
  marker: String,
  attr_name: String,
  value: String,
}

struct RenderContext {
  attrs: Vec<AttrEntry>,
}

fn render(nodes: &[AstNode], data: &Value, ctx: &mut RenderContext) -> String {
  let mut out = String::new();

  for node in nodes {
    match node {
      AstNode::Text(value) => out.push_str(value),

      AstNode::Slot { path, mode } => {
        let value = resolve(path, data);
        match mode {
          SlotMode::Html => {
            out.push_str(&stringify(value.unwrap_or(&Value::Null)));
          }
          SlotMode::Text => {
            out.push_str(&escape_html(&stringify(value.unwrap_or(&Value::Null))));
          }
        }
      }

      AstNode::Attr { path, attr_name } => {
        if let Some(value) = resolve(path, data) {
          let marker = format!("\x00SEAM_ATTR_{}\x00", ctx.attrs.len());
          ctx.attrs.push(AttrEntry {
            marker: marker.clone(),
            attr_name: attr_name.clone(),
            value: escape_html(&stringify(value)),
          });
          out.push_str(&marker);
        }
      }

      AstNode::If { path, then_nodes, else_nodes } => {
        let value = resolve(path, data);
        if value.is_some_and(|v| is_truthy(v)) {
          out.push_str(&render(then_nodes, data, ctx));
        } else {
          out.push_str(&render(else_nodes, data, ctx));
        }
      }

      AstNode::Each { path, body_nodes } => {
        if let Some(Value::Array(arr)) = resolve(path, data) {
          for item in arr {
            // Clone data and inject $ / $$ scope
            let scoped = if let Value::Object(map) = data {
              let mut new_map = map.clone();
              if let Some(current_dollar) = new_map.get("$").cloned() {
                new_map.insert("$$".to_string(), current_dollar);
              }
              new_map.insert("$".to_string(), item.clone());
              Value::Object(new_map)
            } else {
              data.clone()
            };
            out.push_str(&render(body_nodes, &scoped, ctx));
          }
        }
      }

      AstNode::Match { path, branches } => {
        let value = resolve(path, data);
        let key = stringify(value.unwrap_or(&Value::Null));
        for (branch_value, branch_nodes) in branches {
          if *branch_value == key {
            out.push_str(&render(branch_nodes, data, ctx));
            break;
          }
        }
      }
    }
  }

  out
}

// -- Attribute injection (phase B) --

fn inject_attributes(mut html: String, attrs: &[AttrEntry]) -> String {
  for entry in attrs {
    if let Some(pos) = html.find(&entry.marker) {
      html = format!("{}{}", &html[..pos], &html[pos + entry.marker.len()..]);
      if let Some(tag_rel) = html[pos..].find('<') {
        let abs_start = pos + tag_rel;
        let mut tag_name_end = abs_start + 1;
        let bytes = html.as_bytes();
        while tag_name_end < bytes.len()
          && bytes[tag_name_end] != b' '
          && bytes[tag_name_end] != b'>'
          && bytes[tag_name_end] != b'/'
          && bytes[tag_name_end] != b'\n'
          && bytes[tag_name_end] != b'\t'
        {
          tag_name_end += 1;
        }
        let injection = format!(r#" {}="{}""#, entry.attr_name, entry.value);
        html = format!("{}{}{}", &html[..tag_name_end], injection, &html[tag_name_end..]);
      }
    }
  }
  html
}

// -- Entry point --

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
  let script = format!(
    r#"<script id="__SEAM_DATA__" type="application/json">{}</script>"#,
    data
  );
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
    assert_eq!(
      html,
      "<p>&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;</p>"
    );
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
    let html = inject_no_script(
      "<div><!--seam:content:html--></div>",
      &json!({"content": "<b>bold</b>"}),
    );
    assert_eq!(html, "<div><b>bold</b></div>");
  }

  // -- Attribute slots --

  #[test]
  fn attr_slot() {
    let html = inject_no_script(
      "<!--seam:cls:attr:class--><div>hi</div>",
      &json!({"cls": "active"}),
    );
    assert_eq!(html, r#"<div class="active">hi</div>"#);
  }

  #[test]
  fn attr_slot_escapes_value() {
    let html = inject_no_script(
      "<!--seam:v:attr:title--><span>x</span>",
      &json!({"v": "a\"b"}),
    );
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
    let html = inject_no_script(
      "<!--seam:if:name--><p>hi</p><!--seam:endif:name-->",
      &json!({"name": ""}),
    );
    assert_eq!(html, "");
  }

  #[test]
  fn cond_missing_removes() {
    let html = inject_no_script(
      "<!--seam:if:missing--><p>gone</p><!--seam:endif:missing-->",
      &json!({}),
    );
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
    let tmpl = "<!--seam:if:user--><!--seam:user.name--><!--seam:else-->Anonymous<!--seam:endif:user-->";
    assert_eq!(inject_no_script(tmpl, &json!({"user": null})), "Anonymous");
  }

  #[test]
  fn else_empty_array() {
    let tmpl = "<!--seam:if:items--><ul>list</ul><!--seam:else--><p>No items</p><!--seam:endif:items-->";
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
    let tmpl =
      r#"<!--seam:each:links--><!--seam:$.url:attr:href--><a><!--seam:$.text--></a><!--seam:endeach-->"#;
    let data = json!({"links": [{"url": "/a", "text": "A"}, {"url": "/b", "text": "B"}]});
    assert_eq!(
      inject_no_script(tmpl, &data),
      r#"<a href="/a">A</a><a href="/b">B</a>"#
    );
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
    let tmpl =
      "<!--seam:if:x-->outer[<!--seam:if:x-->inner<!--seam:endif:x-->]<!--seam:endif:x-->";
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
    let tmpl = concat!(
      "<!--seam:match:role-->",
      "<!--seam:when:admin-->Admin",
      "<!--seam:endmatch-->"
    );
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
    assert_eq!(
      inject_no_script(tmpl, &json!({"role": "admin", "name": "Alice"})),
      "<b>Alice</b>"
    );
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
