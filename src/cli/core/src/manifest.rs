/* src/cli/core/src/manifest.rs */

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProcedureType {
  Query,
  Command,
  Subscription,
}

impl std::fmt::Display for ProcedureType {
  fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
    match self {
      Self::Query => write!(f, "query"),
      Self::Command => write!(f, "command"),
      Self::Subscription => write!(f, "subscription"),
    }
  }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Manifest {
  pub version: u32,
  pub procedures: BTreeMap<String, ProcedureSchema>,
  #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
  pub channels: BTreeMap<String, ChannelSchema>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProcedureSchema {
  #[serde(rename = "type")]
  pub proc_type: ProcedureType,
  pub input: Value,
  pub output: Value,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub error: Option<Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChannelSchema {
  pub input: Value,
  pub incoming: BTreeMap<String, IncomingSchema>,
  pub outgoing: BTreeMap<String, Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct IncomingSchema {
  pub input: Value,
  pub output: Value,
  #[serde(default, skip_serializing_if = "Option::is_none")]
  pub error: Option<Value>,
}
