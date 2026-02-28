/* packages/server/core/rust/src/manifest.rs */

use std::collections::BTreeMap;

use serde::Serialize;

use crate::procedure::{ProcedureDef, SubscriptionDef};

#[derive(Serialize)]
pub struct Manifest {
  pub version: u32,
  pub procedures: BTreeMap<String, ProcedureSchema>,
}

#[derive(Serialize)]
pub struct ProcedureSchema {
  #[serde(rename = "type")]
  pub proc_type: String,
  pub input: serde_json::Value,
  pub output: serde_json::Value,
}

pub fn build_manifest(procedures: &[ProcedureDef], subscriptions: &[SubscriptionDef]) -> Manifest {
  let mut map = BTreeMap::new();
  for proc in procedures {
    map.insert(
      proc.name.clone(),
      ProcedureSchema {
        proc_type: "query".to_string(),
        input: proc.input_schema.clone(),
        output: proc.output_schema.clone(),
      },
    );
  }
  for sub in subscriptions {
    map.insert(
      sub.name.clone(),
      ProcedureSchema {
        proc_type: "subscription".to_string(),
        input: sub.input_schema.clone(),
        output: sub.output_schema.clone(),
      },
    );
  }
  Manifest { version: 1, procedures: map }
}
