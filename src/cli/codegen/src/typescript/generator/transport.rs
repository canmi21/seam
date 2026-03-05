/* src/cli/codegen/src/typescript/generator/transport.rs */

use std::collections::BTreeMap;

use crate::manifest::{ChannelSchema, Manifest, TransportConfig, TransportPreference};
use crate::rpc_hash::RpcHashMap;

use super::quote_key;

/// Format a fallback array as TypeScript: `["http"] as const`.
fn format_fallback(fallback: &Option<Vec<TransportPreference>>) -> String {
  match fallback {
    Some(v) if !v.is_empty() => {
      let items: Vec<String> = v.iter().map(|p| format!("\"{p}\"")).collect();
      format!("[{}] as const", items.join(", "))
    }
    _ => "[] as const".to_string(),
  }
}

/// Resolve effective channel transport: channel-level > transportDefaults["channel"] > Ws.
pub(super) fn resolve_channel_transport(
  ch: &ChannelSchema,
  defaults: &BTreeMap<String, TransportConfig>,
) -> &'static str {
  if let Some(ref t) = ch.transport {
    return match t.prefer {
      TransportPreference::Http => "http",
      TransportPreference::Sse => "sse",
      TransportPreference::Ws => "ws",
      TransportPreference::Ipc => "ipc",
    };
  }
  if let Some(t) = defaults.get("channel") {
    return match t.prefer {
      TransportPreference::Http => "http",
      TransportPreference::Sse => "sse",
      TransportPreference::Ws => "ws",
      TransportPreference::Ipc => "ipc",
    };
  }
  "ws"
}

/// Resolve effective channel fallback: channel-level > transportDefaults["channel"] > ["http"].
pub(super) fn resolve_channel_fallback(
  ch: &ChannelSchema,
  defaults: &BTreeMap<String, TransportConfig>,
) -> Option<Vec<TransportPreference>> {
  if let Some(ref t) = ch.transport {
    return t.fallback.clone();
  }
  if let Some(t) = defaults.get("channel") {
    return t.fallback.clone();
  }
  Some(vec![TransportPreference::Http])
}

/// Generate transport hint with defaults, procedure overrides, and channel metadata.
pub(super) fn generate_transport_hint(
  manifest: &Manifest,
  rpc_hashes: Option<&RpcHashMap>,
) -> String {
  let mut out = String::from("export const seamTransportHint = {\n");

  // defaults section: always emitted from manifest.transport_defaults
  out.push_str("  defaults: {\n");
  for (kind, tc) in &manifest.transport_defaults {
    out.push_str(&format!(
      "    {kind}: {{ prefer: \"{prefer}\" as const, fallback: {fallback} }},\n",
      prefer = tc.prefer,
      fallback = format_fallback(&tc.fallback),
    ));
  }
  out.push_str("  },\n");

  // procedures section: only those with explicit transport override
  let proc_overrides: Vec<(&String, &TransportConfig)> = manifest
    .procedures
    .iter()
    .filter_map(|(name, schema)| schema.transport.as_ref().map(|t| (name, t)))
    .collect();
  if !proc_overrides.is_empty() {
    out.push_str("  procedures: {\n");
    for (name, tc) in &proc_overrides {
      out.push_str(&format!(
        "    {}: {{ prefer: \"{prefer}\" as const, fallback: {fallback} }},\n",
        quote_key(name),
        prefer = tc.prefer,
        fallback = format_fallback(&tc.fallback),
      ));
    }
    out.push_str("  },\n");
  }

  // channels section
  if !manifest.channels.is_empty() {
    out.push_str("  channels: {\n");
    for (ch_name, ch) in &manifest.channels {
      let transport = resolve_channel_transport(ch, &manifest.transport_defaults);
      let fallback = resolve_channel_fallback(ch, &manifest.transport_defaults);

      out.push_str(&format!("    {}: {{\n", quote_key(ch_name)));
      out.push_str(&format!("      transport: \"{transport}\" as const,\n"));
      out.push_str(&format!("      fallback: {},\n", format_fallback(&fallback)));

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
    out.push_str("  },\n");
  }

  out.push_str("} as const;\n\n");
  out.push_str("export type SeamTransportHint = typeof seamTransportHint;\n\n");
  out
}
