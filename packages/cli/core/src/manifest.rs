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
  pub input: Value,
  pub output: Value,
}
