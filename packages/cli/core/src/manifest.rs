/* packages/cli/core/src/manifest.rs */

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Serialize, Deserialize)]
pub struct Manifest {
  pub version: String,
  pub procedures: BTreeMap<String, ProcedureSchema>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProcedureSchema {
  #[serde(rename = "type", default = "default_proc_type")]
  pub proc_type: String,
  pub input: Value,
  pub output: Value,
}

fn default_proc_type() -> String {
  "query".to_string()
}
