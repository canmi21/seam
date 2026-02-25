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
mod tests;
