/* src/cli/codegen/src/typescript/generator/channel.rs */

use std::collections::BTreeSet;

use anyhow::Result;

use crate::manifest::{ChannelSchema, Manifest};

use super::super::render::{render_top_level, to_pascal_case};

/// Build set of procedure names owned by channels (excluded from SeamProcedures).
pub(super) fn channel_owned_procedures(manifest: &Manifest) -> BTreeSet<String> {
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
pub(super) fn generate_channel_types(manifest: &Manifest) -> Result<String> {
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
fn generate_channel_outgoing(ch: &ChannelSchema, ch_pascal: &str) -> Result<String> {
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

/// Generate the channel factory body (if-branches for each channel).
pub(super) fn generate_channel_factory(manifest: &Manifest) -> String {
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
