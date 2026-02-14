/* packages/server/core/rust/src/manifest.rs */

use std::collections::BTreeMap;

use serde::Serialize;

use crate::procedure::ProcedureDef;

#[derive(Serialize)]
pub struct Manifest {
  pub version: String,
  pub procedures: BTreeMap<String, ProcedureSchema>,
}

#[derive(Serialize)]
pub struct ProcedureSchema {
  pub input: serde_json::Value,
  pub output: serde_json::Value,
}

pub fn build_manifest(procedures: &[ProcedureDef]) -> Manifest {
  let mut map = BTreeMap::new();
  for proc in procedures {
    map.insert(
      proc.name.clone(),
      ProcedureSchema { input: proc.input_schema.clone(), output: proc.output_schema.clone() },
    );
  }
  Manifest { version: "0.1.0".to_string(), procedures: map }
}
