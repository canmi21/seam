/* src/cli/codegen/src/typescript/generator.rs */

use std::collections::BTreeSet;

use anyhow::Result;

use crate::manifest::{Manifest, ProcedureSchema, ProcedureType};
use crate::rpc_hash::RpcHashMap;

use super::render::{render_top_level, to_pascal_case};

/// Wrap name in quotes if it contains characters that make it an invalid JS identifier.
fn quote_key(name: &str) -> String {
  if name.contains('.') { format!("\"{name}\"") } else { name.to_string() }
}

/// Build set of procedure names owned by channels (excluded from SeamProcedures).
fn channel_owned_procedures(manifest: &Manifest) -> BTreeSet<String> {
  let mut owned = BTreeSet::new();
  for (ch_name, ch) in &manifest.channels {
    for msg_name in ch.incoming.keys() {
      owned.insert(format!("{ch_name}.{msg_name}"));
    }
    owned.insert(format!("{ch_name}.events"));
  }
  owned
}

/// Generate channel type declarations, SeamChannels, and channel factory helper.
fn generate_channel_types(manifest: &Manifest) -> Result<String> {
  if manifest.channels.is_empty() {
    return Ok(String::new());
  }

  let mut out = String::new();
  let mut channel_entries: Vec<String> = Vec::new();

  for (ch_name, ch) in &manifest.channels {
    let ch_pascal = to_pascal_case(ch_name);

    // Channel input type
    let input_type = format!("{ch_pascal}ChannelInput");
    out.push_str(&render_top_level(&input_type, &ch.input)?);
    out.push('\n');

    // Incoming message types
    let mut handle_methods: Vec<String> = Vec::new();
    for (msg_name, msg) in &ch.incoming {
      let msg_pascal = to_pascal_case(msg_name);
      let msg_input_type = format!("{ch_pascal}{msg_pascal}Input");
      let msg_output_type = format!("{ch_pascal}{msg_pascal}Output");

      out.push_str(&render_top_level(&msg_input_type, &msg.input)?);
      out.push('\n');
      out.push_str(&render_top_level(&msg_output_type, &msg.output)?);
      out.push('\n');

      if let Some(ref error_schema) = msg.error {
        let msg_error_type = format!("{ch_pascal}{msg_pascal}Error");
        out.push_str(&render_top_level(&msg_error_type, error_schema)?);
        out.push('\n');
      }

      handle_methods
        .push(format!("  {msg_name}(input: {msg_input_type}): Promise<{msg_output_type}>;"));
    }

    // Outgoing event payload types + union
    out.push_str(&generate_channel_outgoing(ch, &ch_pascal)?);

    // Channel handle interface
    let event_type = format!("{ch_pascal}Event");
    let handle_type = format!("{ch_pascal}Channel");
    out.push_str(&format!("export interface {handle_type} {{\n"));
    for method in &handle_methods {
      out.push_str(method);
      out.push('\n');
    }
    out.push_str(&format!(
      "  on<E extends {event_type}[\"type\"]>(\n    event: E,\n    callback: (data: Extract<{event_type}, {{ type: E }}>[\"payload\"]) => void,\n  ): void;\n"
    ));
    out.push_str("  close(): void;\n");
    out.push_str("}\n\n");

    // SeamChannels entry
    channel_entries.push(format!("  {ch_name}: {{ input: {input_type}; handle: {handle_type} }};"));
  }

  // SeamChannels interface
  out.push_str("export interface SeamChannels {\n");
  for entry in &channel_entries {
    out.push_str(entry);
    out.push('\n');
  }
  out.push_str("}\n\n");

  Ok(out)
}

/// Generate outgoing event payload types and the discriminated union for a channel.
fn generate_channel_outgoing(
  ch: &crate::manifest::ChannelSchema,
  ch_pascal: &str,
) -> Result<String> {
  let mut out = String::new();
  let mut union_parts: Vec<String> = Vec::new();

  for (evt_name, evt_schema) in &ch.outgoing {
    let evt_pascal = to_pascal_case(evt_name);
    let payload_type = format!("{ch_pascal}{evt_pascal}Payload");
    out.push_str(&render_top_level(&payload_type, evt_schema)?);
    out.push('\n');
    union_parts.push(format!("  | {{ type: \"{evt_name}\"; payload: {payload_type} }}"));
  }

  let event_type = format!("{ch_pascal}Event");
  out.push_str(&format!("export type {event_type} =\n"));
  for part in &union_parts {
    out.push_str(part);
    out.push('\n');
  }
  out.push_str(";\n\n");
  Ok(out)
}

/// Generate SeamProcedureMeta type map (includes all procedures, even channel-owned).
fn generate_procedure_meta(manifest: &Manifest) -> String {
  // Build lookup for channel event procedures ({ch}.events) whose types
  // are named differently: input = {Ch}ChannelInput, output = {Ch}Event.
  let channel_event_names: BTreeSet<String> =
    manifest.channels.keys().map(|ch| format!("{ch}.events")).collect();

  let mut out = String::from("export interface SeamProcedureMeta {\n");
  for (name, schema) in &manifest.procedures {
    let pascal = to_pascal_case(name);
    let key = quote_key(name);
    let kind = match schema.proc_type {
      ProcedureType::Query => "query",
      ProcedureType::Command => "command",
      ProcedureType::Subscription => "subscription",
      ProcedureType::Stream => "stream",
      ProcedureType::Upload => "upload",
    };
    let (input_name, output_name) = if channel_event_names.contains(name) {
      // Channel event subscription: types follow channel naming convention
      let ch_name = name.strip_suffix(".events").expect("channel event name has .events suffix");
      let ch_pascal = to_pascal_case(ch_name);
      (format!("{ch_pascal}ChannelInput"), format!("{ch_pascal}Event"))
    } else if schema.proc_type == ProcedureType::Stream {
      (format!("{pascal}Input"), format!("{pascal}Chunk"))
    } else {
      (format!("{pascal}Input"), format!("{pascal}Output"))
    };
    let mut extra_fields = String::new();
    if schema.error.is_some() {
      let error_name = format!("{pascal}Error");
      extra_fields.push_str(&format!("; error: {error_name}"));
    }
    if let Some(targets) = &schema.invalidates
      && !targets.is_empty()
    {
      let names: Vec<String> = targets.iter().map(|t| format!("\"{}\"", t.query)).collect();
      extra_fields.push_str(&format!("; invalidates: readonly [{}]", names.join(", ")));
    }
    if let Some(ctx_keys) = &schema.context
      && !ctx_keys.is_empty()
    {
      let keys_str: Vec<String> = ctx_keys.iter().map(|k| format!("\"{k}\"")).collect();
      extra_fields.push_str(&format!("; context: readonly [{}]", keys_str.join(", ")));
    }
    out.push_str(&format!(
      "  {key}: {{ kind: \"{kind}\"; input: {input_name}; output: {output_name}{extra_fields} }};\n"
    ));
  }
  out.push_str("}\n\n");
  out
}

/// Generate transport hint for channels (WS metadata for auto-selection).
fn generate_transport_hint(manifest: &Manifest, rpc_hashes: Option<&RpcHashMap>) -> String {
  if manifest.channels.is_empty() {
    return String::new();
  }

  let mut out = String::from("export const seamTransportHint = {\n  channels: {\n");

  for (ch_name, ch) in &manifest.channels {
    out.push_str(&format!("    {}: {{\n", quote_key(ch_name)));
    out.push_str("      transport: \"ws\" as const,\n");

    let incoming: Vec<String> = ch
      .incoming
      .keys()
      .map(|msg_name| {
        let full_name = format!("{ch_name}.{msg_name}");
        let wire = rpc_hashes
          .and_then(|m| m.procedures.get(&full_name))
          .map(String::as_str)
          .unwrap_or(full_name.as_str());
        format!("\"{wire}\"")
      })
      .collect();
    out.push_str(&format!("      incoming: [{}],\n", incoming.join(", ")));

    let events_name = format!("{ch_name}.events");
    let events_wire = rpc_hashes
      .and_then(|m| m.procedures.get(&events_name))
      .map(String::as_str)
      .unwrap_or(events_name.as_str());
    out.push_str(&format!("      outgoing: \"{events_wire}\",\n"));

    out.push_str("    },\n");
  }

  out.push_str("  },\n} as const;\n\n");
  out.push_str("export type SeamTransportHint = typeof seamTransportHint;\n\n");
  out
}

/// Generate a dependency-free `meta.ts` exporting only DATA_ID.
pub fn generate_typescript_meta(data_id: &str) -> String {
  format!("// Auto-generated by seam. Do not edit.\nexport const DATA_ID = \"{data_id}\";\n")
}

/// Resolve the wire name for a procedure (hashed name if available, original otherwise).
fn resolve_wire_name<'a>(name: &'a str, rpc_hashes: Option<&'a RpcHashMap>) -> &'a str {
  rpc_hashes.and_then(|m| m.procedures.get(name)).map(String::as_str).unwrap_or(name)
}

/// Emit import declarations based on procedure kinds present in the manifest.
fn generate_imports(has_stream: bool) -> String {
  let mut out = String::from("import { createClient } from \"@canmi/seam-client\";\n");
  if has_stream {
    out.push_str(
      "import type { SeamClient, SeamClientError, ProcedureKind, Unsubscribe, StreamHandle } from \"@canmi/seam-client\";\n\n",
    );
  } else {
    out.push_str(
      "import type { SeamClient, SeamClientError, ProcedureKind, Unsubscribe } from \"@canmi/seam-client\";\n\n",
    );
  }
  out
}

/// Emit type declarations for each non-channel procedure and collect interface/factory lines.
fn generate_procedure_declarations(
  manifest: &Manifest,
  rpc_hashes: Option<&RpcHashMap>,
  channel_owned: &BTreeSet<String>,
) -> Result<(String, Vec<String>, Vec<String>)> {
  let mut out = String::new();
  let mut iface_lines: Vec<String> = Vec::new();
  let mut factory_lines: Vec<String> = Vec::new();

  for (name, schema) in &manifest.procedures {
    if channel_owned.contains(name) {
      continue;
    }

    let pascal = to_pascal_case(name);
    let key = quote_key(name);

    let input_name = format!("{pascal}Input");
    // Stream uses "Chunk" suffix to clarify it's the chunk type, not a single output
    let output_name = if schema.proc_type == ProcedureType::Stream {
      format!("{pascal}Chunk")
    } else {
      format!("{pascal}Output")
    };

    out.push_str(&render_top_level(&input_name, &schema.input)?);
    out.push('\n');

    if let Some(output_schema) = schema.effective_output() {
      out.push_str(&render_top_level(&output_name, output_schema)?);
      out.push('\n');
    }

    if let Some(ref error_schema) = schema.error {
      let error_name = format!("{pascal}Error");
      out.push_str(&render_top_level(&error_name, error_schema)?);
      out.push('\n');
    }

    let wire_name = resolve_wire_name(name, rpc_hashes);
    let (iface, factory) =
      procedure_client_lines(&key, &input_name, &output_name, wire_name, schema);
    iface_lines.push(iface);
    factory_lines.push(factory);
  }

  Ok((out, iface_lines, factory_lines))
}

/// Produce one interface line and one factory line for a procedure.
fn procedure_client_lines(
  key: &str,
  input: &str,
  output: &str,
  wire: &str,
  schema: &ProcedureSchema,
) -> (String, String) {
  match schema.proc_type {
    ProcedureType::Stream => (
      format!("  {key}(input: {input}): StreamHandle<{output}>;"),
      format!("    {key}: (input) => client.stream(\"{wire}\", input) as StreamHandle<{output}>,"),
    ),
    ProcedureType::Subscription => (
      format!(
        "  {key}(input: {input}, onData: (data: {output}) => void, onError?: (err: SeamClientError) => void): Unsubscribe;"
      ),
      format!(
        "    {key}: (input, onData, onError) => client.subscribe(\"{wire}\", input, onData as (data: unknown) => void, onError),"
      ),
    ),
    ProcedureType::Upload => (
      format!("  {key}(input: {input}, file: File | Blob): Promise<{output}>;"),
      format!(
        "    {key}: (input, file) => client.upload(\"{wire}\", input, file) as Promise<{output}>,"
      ),
    ),
    _ => {
      let method = if schema.proc_type == ProcedureType::Command { "command" } else { "query" };
      (
        format!("  {key}(input: {input}): Promise<{output}>;"),
        format!("    {key}: (input) => client.{method}(\"{wire}\", input) as Promise<{output}>,"),
      )
    }
  }
}

/// Emit the `createSeamClient` factory function.
fn generate_client_factory(
  manifest: &Manifest,
  rpc_hashes: Option<&RpcHashMap>,
  factory_lines: &[String],
  has_channels: bool,
) -> String {
  let return_type = if has_channels {
    "SeamProcedures & {\n  channel<K extends keyof SeamChannels>(\n    name: K,\n    input: SeamChannels[K][\"input\"],\n  ): SeamChannels[K][\"handle\"];\n}"
  } else {
    "SeamProcedures"
  };

  let mut out = format!("export function createSeamClient(baseUrl: string): {return_type} {{\n");

  // Build createClient options
  let mut opts_parts = vec![String::from("baseUrl")];
  if let Some(map) = rpc_hashes {
    opts_parts.push(format!("batchEndpoint: \"{}\"", map.batch));
  }
  if has_channels {
    let entries: Vec<String> =
      manifest.channels.keys().map(|name| format!("{}: \"ws\"", quote_key(name))).collect();
    opts_parts.push(format!("channelTransports: {{ {} }}", entries.join(", ")));
  }
  out.push_str(&format!(
    "  const client: SeamClient = createClient({{ {} }});\n",
    opts_parts.join(", ")
  ));

  if has_channels {
    out.push_str("  function channel<K extends keyof SeamChannels>(name: K, input: SeamChannels[K][\"input\"]): SeamChannels[K][\"handle\"] {\n");
    out.push_str(&generate_channel_factory(manifest));
    out.push_str("    throw new Error(`Unknown channel: ${name as string}`);\n");
    out.push_str("  }\n");
  }

  out.push_str("  return {\n");
  for line in factory_lines {
    out.push_str(line);
    out.push('\n');
  }
  if has_channels {
    out.push_str("    channel,\n");
  }
  out.push_str("  };\n");
  out.push_str("}\n");

  out
}

/// Generate a typed TypeScript client from a manifest.
pub fn generate_typescript(
  manifest: &Manifest,
  rpc_hashes: Option<&RpcHashMap>,
  _data_id: &str,
) -> Result<String> {
  let mut out = String::from("// Auto-generated by seam. Do not edit.\n");

  let has_channels = !manifest.channels.is_empty();
  let has_stream = manifest.procedures.values().any(|s| s.proc_type == ProcedureType::Stream);

  out.push_str(&generate_imports(has_stream));
  out.push_str("export { DATA_ID } from \"./meta.js\";\n\n");

  let channel_owned = channel_owned_procedures(manifest);
  let (type_decls, iface_lines, factory_lines) =
    generate_procedure_declarations(manifest, rpc_hashes, &channel_owned)?;
  out.push_str(&type_decls);

  out.push_str("export interface SeamProcedures {\n");
  for line in &iface_lines {
    out.push_str(line);
    out.push('\n');
  }
  out.push_str("}\n\n");

  out.push_str(&generate_procedure_meta(manifest));

  if has_channels {
    out.push_str(&generate_channel_types(manifest)?);
    out.push_str(&generate_transport_hint(manifest, rpc_hashes));
  }

  out.push_str(&generate_client_factory(manifest, rpc_hashes, &factory_lines, has_channels));

  Ok(out)
}

/// Generate the channel factory body (if-branches for each channel).
fn generate_channel_factory(manifest: &Manifest) -> String {
  let mut out = String::new();

  for ch_name in manifest.channels.keys() {
    out.push_str(&format!("    if (name === \"{ch_name}\") {{\n"));
    out.push_str(
      "      return client.channel(name, input) as unknown as SeamChannels[typeof name][\"handle\"];\n",
    );
    out.push_str("    }\n");
  }

  out
}
