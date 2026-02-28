/* packages/cli/core/src/codegen/typescript/generator.rs */

use std::collections::BTreeSet;

use anyhow::Result;

use crate::build::rpc_hash::RpcHashMap;
use crate::manifest::{Manifest, ProcedureType};

use super::render::{render_top_level, to_pascal_case};

/// Wrap name in quotes if it contains characters that make it an invalid JS identifier.
fn quote_key(name: &str) -> String {
  if name.contains('.') {
    format!("\"{name}\"")
  } else {
    name.to_string()
  }
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
    };
    let (input_name, output_name) = if channel_event_names.contains(name) {
      // Channel event subscription: types follow channel naming convention
      let ch_name = name.strip_suffix(".events").unwrap();
      let ch_pascal = to_pascal_case(ch_name);
      (format!("{ch_pascal}ChannelInput"), format!("{ch_pascal}Event"))
    } else {
      (format!("{pascal}Input"), format!("{pascal}Output"))
    };
    if schema.error.is_some() {
      let error_name = format!("{pascal}Error");
      out.push_str(&format!(
        "  {key}: {{ kind: \"{kind}\"; input: {input_name}; output: {output_name}; error: {error_name} }};\n"
      ));
    } else {
      out.push_str(&format!(
        "  {key}: {{ kind: \"{kind}\"; input: {input_name}; output: {output_name} }};\n"
      ));
    }
  }
  out.push_str("}\n\n");
  out
}

/// Generate a typed TypeScript client from a manifest.
pub fn generate_typescript(
  manifest: &Manifest,
  rpc_hashes: Option<&RpcHashMap>,
  data_id: &str,
) -> Result<String> {
  let mut out = String::new();
  out.push_str("// Auto-generated by seam. Do not edit.\n");

  let has_channels = !manifest.channels.is_empty();

  out.push_str("import { createClient } from \"@canmi/seam-client\";\n");
  out.push_str(
    "import type { SeamClient, SeamClientError, ProcedureKind, Unsubscribe } from \"@canmi/seam-client\";\n\n",
  );

  out.push_str(&format!("export const DATA_ID = \"{}\";\n\n", data_id));

  let channel_owned = channel_owned_procedures(manifest);

  let mut iface_lines: Vec<String> = Vec::new();
  let mut factory_lines: Vec<String> = Vec::new();

  for (name, schema) in &manifest.procedures {
    // Skip channel-owned procedures from standalone generation
    if channel_owned.contains(name) {
      continue;
    }

    let pascal = to_pascal_case(name);
    let key = quote_key(name);
    let is_subscription = schema.proc_type == ProcedureType::Subscription;

    let input_name = format!("{pascal}Input");
    let output_name = format!("{pascal}Output");

    let input_decl = render_top_level(&input_name, &schema.input)?;
    let output_decl = render_top_level(&output_name, &schema.output)?;

    out.push_str(&input_decl);
    out.push('\n');
    out.push_str(&output_decl);
    out.push('\n');

    if let Some(ref error_schema) = schema.error {
      let error_name = format!("{pascal}Error");
      let error_decl = render_top_level(&error_name, error_schema)?;
      out.push_str(&error_decl);
      out.push('\n');
    }

    let wire_name =
      rpc_hashes.and_then(|m| m.procedures.get(name)).map(|h| h.as_str()).unwrap_or(name.as_str());

    if is_subscription {
      iface_lines.push(format!(
        "  {key}(input: {input_name}, onData: (data: {output_name}) => void, onError?: (err: SeamClientError) => void): Unsubscribe;"
      ));
      factory_lines.push(format!(
        "    {key}: (input, onData, onError) => client.subscribe(\"{wire_name}\", input, onData as (data: unknown) => void, onError),"
      ));
    } else {
      let method = match schema.proc_type {
        ProcedureType::Command => "command",
        _ => "query",
      };
      iface_lines.push(format!("  {key}(input: {input_name}): Promise<{output_name}>;"));
      factory_lines.push(format!(
        "    {key}: (input) => client.{method}(\"{wire_name}\", input) as Promise<{output_name}>,"
      ));
    }
  }

  out.push_str("export interface SeamProcedures {\n");
  for line in &iface_lines {
    out.push_str(line);
    out.push('\n');
  }
  out.push_str("}\n\n");

  out.push_str(&generate_procedure_meta(manifest));

  // Channel types
  if has_channels {
    out.push_str(&generate_channel_types(manifest)?);
  }

  // createSeamClient factory
  let return_type = if has_channels {
    "SeamProcedures & {\n  channel<K extends keyof SeamChannels>(\n    name: K,\n    input: SeamChannels[K][\"input\"],\n  ): SeamChannels[K][\"handle\"];\n}"
  } else {
    "SeamProcedures"
  };

  if let Some(map) = rpc_hashes {
    out.push_str(&format!("export function createSeamClient(baseUrl: string): {return_type} {{\n"));
    out.push_str(&format!(
      "  const client: SeamClient = createClient({{ baseUrl, batchEndpoint: \"{}\" }});\n",
      map.batch
    ));
  } else {
    out.push_str(&format!("export function createSeamClient(baseUrl: string): {return_type} {{\n"));
    out.push_str("  const client: SeamClient = createClient({ baseUrl });\n");
  }

  if has_channels {
    // Build channel factory function
    out.push_str("  function channel<K extends keyof SeamChannels>(name: K, input: SeamChannels[K][\"input\"]): SeamChannels[K][\"handle\"] {\n");

    let channel_factory = generate_channel_factory(manifest, rpc_hashes)?;
    out.push_str(&channel_factory);

    out.push_str("    throw new Error(`Unknown channel: ${name as string}`);\n");
    out.push_str("  }\n");
  }

  out.push_str("  return {\n");
  for line in &factory_lines {
    out.push_str(line);
    out.push('\n');
  }
  if has_channels {
    out.push_str("    channel,\n");
  }
  out.push_str("  };\n");
  out.push_str("}\n");

  Ok(out)
}

/// Generate the channel factory body (if-branches for each channel).
fn generate_channel_factory(
  manifest: &Manifest,
  rpc_hashes: Option<&RpcHashMap>,
) -> Result<String> {
  let mut out = String::new();

  for (ch_name, ch) in &manifest.channels {
    let ch_pascal = to_pascal_case(ch_name);
    let input_type = format!("{ch_pascal}ChannelInput");

    out.push_str(&format!("    if (name === \"{ch_name}\") {{\n"));
    out.push_str("      const listeners = new Map<string, Set<(data: unknown) => void>>();\n");
    out.push_str(&format!("      const channelInput = input as {input_type};\n"));
    out.push_str("      let unsub: (() => void) | null = null;\n");
    out.push_str("      function ensureSubscription() {\n");
    out.push_str("        if (unsub) return;\n");

    let events_wire = format!("{ch_name}.events");
    let events_wire_name = rpc_hashes
      .and_then(|m| m.procedures.get(&events_wire))
      .map(|h| h.as_str())
      .unwrap_or(events_wire.as_str());

    out.push_str(&format!(
      "        unsub = client.subscribe(\"{events_wire_name}\", channelInput, (raw: unknown) => {{\n"
    ));
    out.push_str("          const event = raw as { type: string; payload: unknown };\n");
    out.push_str("          const cbs = listeners.get(event.type);\n");
    out.push_str("          if (cbs) for (const cb of cbs) cb(event.payload);\n");
    out.push_str("        });\n");
    out.push_str("      }\n");
    out.push_str("      return {\n");

    // Incoming message methods
    for msg_name in ch.incoming.keys() {
      let msg_pascal = to_pascal_case(msg_name);
      let msg_output_type = format!("{ch_pascal}{msg_pascal}Output");
      let wire_name = format!("{ch_name}.{msg_name}");
      let wire = rpc_hashes
        .and_then(|m| m.procedures.get(&wire_name))
        .map(|h| h.as_str())
        .unwrap_or(wire_name.as_str());

      out.push_str(&format!(
        "        {msg_name}: (msgInput: unknown) => client.command(\"{wire}\", {{ ...channelInput, ...msgInput as object }}) as Promise<{msg_output_type}>,\n"
      ));
    }

    out.push_str("        on: (event: string, callback: (data: unknown) => void) => {\n");
    out.push_str("          let cbs = listeners.get(event);\n");
    out.push_str("          if (!cbs) { cbs = new Set(); listeners.set(event, cbs); }\n");
    out.push_str("          cbs.add(callback);\n");
    out.push_str("          ensureSubscription();\n");
    out.push_str("        },\n");
    out.push_str(
      "        close: () => { if (unsub) { unsub(); unsub = null; } listeners.clear(); },\n",
    );
    out.push_str("      } as unknown as SeamChannels[typeof name][\"handle\"];\n");
    out.push_str("    }\n");
  }

  Ok(out)
}
