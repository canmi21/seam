/* packages/server/core/rust/src/injector/render.rs */

use serde_json::Value;

use super::ast::{AstNode, SlotMode};
use super::helpers::{escape_html, is_html_boolean_attr, is_truthy, resolve, stringify};

pub(super) struct AttrEntry {
  pub(super) marker: String,
  pub(super) attr_name: String,
  pub(super) value: String,
}

pub(super) struct RenderContext {
  pub(super) attrs: Vec<AttrEntry>,
}

pub(super) fn render(nodes: &[AstNode], data: &Value, ctx: &mut RenderContext) -> String {
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
          if is_html_boolean_attr(attr_name) {
            // Boolean HTML attrs: truthy -> attr="", falsy -> omit
            if is_truthy(value) {
              let marker = format!("\x00SEAM_ATTR_{}\x00", ctx.attrs.len());
              ctx.attrs.push(AttrEntry {
                marker: marker.clone(),
                attr_name: attr_name.clone(),
                value: String::new(),
              });
              out.push_str(&marker);
            }
          } else {
            let marker = format!("\x00SEAM_ATTR_{}\x00", ctx.attrs.len());
            ctx.attrs.push(AttrEntry {
              marker: marker.clone(),
              attr_name: attr_name.clone(),
              value: escape_html(&stringify(value)),
            });
            out.push_str(&marker);
          }
        }
      }

      AstNode::If { path, then_nodes, else_nodes } => {
        let value = resolve(path, data);
        if value.is_some_and(is_truthy) {
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

pub(super) fn inject_attributes(mut html: String, attrs: &[AttrEntry]) -> String {
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
