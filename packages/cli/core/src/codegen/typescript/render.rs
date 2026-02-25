/* packages/cli/core/src/codegen/typescript/render.rs */

use std::collections::BTreeMap;

use anyhow::{Context, Result};
use serde_json::Value;

/// Render a top-level named type declaration.
/// Properties form -> `export interface`, other forms -> `export type`.
/// Empty properties form -> `Record<string, never>` to avoid lint-unfriendly empty interfaces.
pub(super) fn render_top_level(name: &str, schema: &Value) -> Result<String> {
  if is_properties_form(schema) {
    let has_props =
      schema.get("properties").and_then(|v| v.as_object()).is_some_and(|o| !o.is_empty());
    let has_opt =
      schema.get("optionalProperties").and_then(|v| v.as_object()).is_some_and(|o| !o.is_empty());
    if !has_props && !has_opt {
      return Ok(format!("export type {name} = Record<string, never>;\n"));
    }
    render_interface(name, schema)
  } else {
    let ts = render_type(schema).with_context(|| format!("rendering type for {name}"))?;
    Ok(format!("export type {name} = {ts};\n"))
  }
}

/// Render a JTD properties-form schema as a TypeScript interface.
fn render_interface(name: &str, schema: &Value) -> Result<String> {
  let nullable = schema.get("nullable").and_then(|v| v.as_bool()).unwrap_or(false);
  let mut out = String::new();

  out.push_str(&format!("export interface {name} {{\n"));

  if let Some(props) = schema.get("properties").and_then(|v| v.as_object()) {
    let sorted: BTreeMap<_, _> = props.iter().collect();
    for (key, val) in sorted {
      let ts = render_type(val)?;
      out.push_str(&format!("  {key}: {ts};\n"));
    }
  }

  if let Some(opt_props) = schema.get("optionalProperties").and_then(|v| v.as_object()) {
    let sorted: BTreeMap<_, _> = opt_props.iter().collect();
    for (key, val) in sorted {
      let ts = render_type(val)?;
      out.push_str(&format!("  {key}?: {ts};\n"));
    }
  }

  out.push_str("}\n");

  if nullable {
    // Wrap as type alias instead
    return Ok(
      format!("export type {name} = {name}Inner | null;\n\nexport interface {name}Inner {{\n")
        + &out[format!("export interface {name} {{\n").len()..],
    );
  }

  Ok(out)
}

/// Recursively render a JTD schema as a TypeScript type expression.
pub(super) fn render_type(schema: &Value) -> Result<String> {
  let nullable = schema.get("nullable").and_then(|v| v.as_bool()).unwrap_or(false);
  let inner = render_type_inner(schema)?;

  if nullable {
    Ok(format!("{inner} | null"))
  } else {
    Ok(inner)
  }
}

fn render_type_inner(schema: &Value) -> Result<String> {
  let obj = match schema.as_object() {
    Some(o) => o,
    None => anyhow::bail!("schema must be a JSON object"),
  };

  // Empty form (only nullable key or truly empty)
  let meaningful_keys: Vec<_> = obj.keys().filter(|k| *k != "nullable").collect();
  if meaningful_keys.is_empty() {
    return Ok("unknown".to_string());
  }

  // Type form
  if let Some(t) = obj.get("type").and_then(|v| v.as_str()) {
    return Ok(jtd_type_to_ts(t).to_string());
  }

  // Enum form
  if let Some(variants) = obj.get("enum").and_then(|v| v.as_array()) {
    let parts: Vec<String> =
      variants.iter().filter_map(|v| v.as_str()).map(|s| format!("\"{s}\"")).collect();
    return Ok(parts.join(" | "));
  }

  // Elements form
  if let Some(elem) = obj.get("elements") {
    let inner = render_type(elem)?;
    return Ok(format!("Array<{inner}>"));
  }

  // Values form
  if let Some(val) = obj.get("values") {
    let inner = render_type(val)?;
    return Ok(format!("Record<string, {inner}>"));
  }

  // Discriminator form
  if let Some(tag) = obj.get("discriminator").and_then(|v| v.as_str()) {
    if let Some(mapping) = obj.get("mapping").and_then(|v| v.as_object()) {
      let sorted: BTreeMap<_, _> = mapping.iter().collect();
      let parts: Vec<String> = sorted
        .iter()
        .map(|(key, variant)| {
          let variant_ts = render_type(variant)?;
          Ok(format!("({{ {tag}: \"{key}\" }} & {variant_ts})"))
        })
        .collect::<Result<Vec<_>>>()?;
      return Ok(parts.join(" | "));
    }
  }

  // Properties form
  if is_properties_form(schema) {
    return render_inline_object(schema);
  }

  // Ref form (not used in v0.1.0, but handle gracefully)
  if let Some(r) = obj.get("ref").and_then(|v| v.as_str()) {
    return Ok(r.to_string());
  }

  anyhow::bail!("unrecognized JTD schema form: {schema}")
}

fn render_inline_object(schema: &Value) -> Result<String> {
  let mut fields = Vec::new();

  if let Some(props) = schema.get("properties").and_then(|v| v.as_object()) {
    let sorted: BTreeMap<_, _> = props.iter().collect();
    for (key, val) in sorted {
      let ts = render_type(val)?;
      fields.push(format!("{key}: {ts}"));
    }
  }

  if let Some(opt_props) = schema.get("optionalProperties").and_then(|v| v.as_object()) {
    let sorted: BTreeMap<_, _> = opt_props.iter().collect();
    for (key, val) in sorted {
      let ts = render_type(val)?;
      fields.push(format!("{key}?: {ts}"));
    }
  }

  Ok(format!("{{ {} }}", fields.join("; ")))
}

fn is_properties_form(schema: &Value) -> bool {
  schema.get("properties").is_some() || schema.get("optionalProperties").is_some()
}

fn jtd_type_to_ts(t: &str) -> &str {
  match t {
    "string" | "timestamp" => "string",
    "boolean" => "boolean",
    "int8" | "int16" | "int32" | "uint8" | "uint16" | "uint32" | "float32" | "float64" => "number",
    _ => "unknown",
  }
}

pub(super) fn capitalize(s: &str) -> String {
  let mut chars = s.chars();
  match chars.next() {
    Some(c) => c.to_uppercase().to_string() + chars.as_str(),
    None => String::new(),
  }
}
