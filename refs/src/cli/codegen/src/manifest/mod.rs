/* src/cli/codegen/src/manifest/mod.rs */

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[cfg(test)]
mod tests;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProcedureType {
	Query,
	Command,
	Subscription,
	Stream,
	Upload,
}

impl std::fmt::Display for ProcedureType {
	fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
		match self {
			Self::Query => write!(f, "query"),
			Self::Command => write!(f, "command"),
			Self::Subscription => write!(f, "subscription"),
			Self::Stream => write!(f, "stream"),
			Self::Upload => write!(f, "upload"),
		}
	}
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TransportPreference {
	Http,
	Sse,
	Ws,
	Ipc,
}

impl std::fmt::Display for TransportPreference {
	fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
		match self {
			Self::Http => write!(f, "http"),
			Self::Sse => write!(f, "sse"),
			Self::Ws => write!(f, "ws"),
			Self::Ipc => write!(f, "ipc"),
		}
	}
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransportConfig {
	pub prefer: TransportPreference,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub fallback: Option<Vec<TransportPreference>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextSchema {
	pub extract: String,
	pub schema: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
	pub version: u32,
	#[serde(default)]
	pub context: BTreeMap<String, ContextSchema>,
	pub procedures: BTreeMap<String, ProcedureSchema>,
	#[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
	pub channels: BTreeMap<String, ChannelSchema>,
	#[serde(default, rename = "transportDefaults")]
	pub transport_defaults: BTreeMap<String, TransportConfig>,
}

impl Manifest {
	pub fn validate_context_refs(&self) -> Result<(), Vec<String>> {
		let mut errors = vec![];
		for (proc_name, schema) in &self.procedures {
			if let Some(ctx_keys) = &schema.context {
				for key in ctx_keys {
					if !self.context.contains_key(key) {
						errors.push(format!("Procedure '{proc_name}' references undefined context '{key}'"));
					}
				}
			}
		}
		if errors.is_empty() { Ok(()) } else { Err(errors) }
	}
}

/// Cache hint for query procedures: `{ "ttl": 30 }` or `false`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum CacheHint {
	Config { ttl: u64 },
	Disabled(bool),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcedureSchema {
	#[serde(rename = "kind", alias = "type")]
	pub proc_type: ProcedureType,
	pub input: Value,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub output: Option<Value>,
	#[serde(default, skip_serializing_if = "Option::is_none", rename = "chunkOutput")]
	pub chunk_output: Option<Value>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub error: Option<Value>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub invalidates: Option<Vec<InvalidateTarget>>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub context: Option<Vec<String>>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub transport: Option<TransportConfig>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub suppress: Option<Vec<String>>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub cache: Option<CacheHint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvalidateTarget {
	pub query: String,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub mapping: Option<BTreeMap<String, MappingValue>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MappingValue {
	pub from: String,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub each: Option<bool>,
}

impl ProcedureSchema {
	/// Return the effective output schema: chunkOutput for streams, output for others.
	pub fn effective_output(&self) -> Option<&Value> {
		self.chunk_output.as_ref().or(self.output.as_ref())
	}
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChannelSchema {
	pub input: Value,
	pub incoming: BTreeMap<String, IncomingSchema>,
	pub outgoing: BTreeMap<String, Value>,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub transport: Option<TransportConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IncomingSchema {
	pub input: Value,
	pub output: Value,
	#[serde(default, skip_serializing_if = "Option::is_none")]
	pub error: Option<Value>,
}
