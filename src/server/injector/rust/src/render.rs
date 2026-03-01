/* src/server/injector/rust/src/render.rs */

use serde_json::Value;

use crate::ast::{AstNode, SlotMode};
use crate::helpers::{
  escape_html, format_style_value, is_html_boolean_attr, is_truthy, resolve, stringify,
};

pub(crate) struct AttrEntry {
  pub(crate) marker: String,
  pub(crate) attr_name: String,
  pub(crate) value: String,
}

pub(crate) struct StyleAttrEntry {
  pub(crate) marker: String,
  pub(crate) css_property: String,
  pub(crate) value: String,
}

pub(crate) struct RenderContext {
  pub(crate) attrs: Vec<AttrEntry>,
  pub(crate) style_attrs: Vec<StyleAttrEntry>,
}

pub(crate) fn render(nodes: &[AstNode], data: &Value, ctx: &mut RenderContext) -> String {
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
          // Null-byte delimited markers (\x00SEAM_ATTR_N\x00) are collected here and
          // resolved in Phase B (inject_attributes). Null bytes are safe delimiters
          // because the HTML spec forbids U+0000 and we strip them from input.
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

      AstNode::StyleProp { path, css_property } => {
        if let Some(value) = resolve(path, data) {
          if let Some(formatted) = format_style_value(css_property, value) {
            let marker = format!("\x00SEAM_STYLE_{}\x00", ctx.style_attrs.len());
            ctx.style_attrs.push(StyleAttrEntry {
              marker: marker.clone(),
              css_property: css_property.clone(),
              value: formatted,
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

pub(crate) fn inject_attributes(mut html: String, attrs: &[AttrEntry]) -> String {
  for entry in attrs.iter().rev() {
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

pub(crate) fn inject_style_attributes(mut html: String, entries: &[StyleAttrEntry]) -> String {
  for entry in entries {
    if let Some(pos) = html.find(&entry.marker) {
      // Remove marker
      html = format!("{}{}", &html[..pos], &html[pos + entry.marker.len()..]);
      // Find next opening tag
      if let Some(tag_rel) = html[pos..].find('<') {
        let abs_start = pos + tag_rel;
        let tag_end = html[abs_start..].find('>').map(|p| abs_start + p).unwrap_or(html.len());
        let tag_content = &html[abs_start..tag_end];

        if let Some(style_rel) = tag_content.find("style=\"") {
          // Merge into existing style attribute
          let abs_style_val_start = abs_start + style_rel + 7;
          let style_val_end = html[abs_style_val_start..]
            .find('"')
            .map(|p| abs_style_val_start + p)
            .unwrap_or(html.len());
          let injection = format!(";{}:{}", entry.css_property, entry.value);
          html.insert_str(style_val_end, &injection);
        } else {
          // Insert new style attribute after tag name
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
          let injection = format!(r#" style="{}:{}""#, entry.css_property, entry.value);
          html = format!("{}{}{}", &html[..tag_name_end], injection, &html[tag_name_end..]);
        }
      }
    }
  }
  html
}
