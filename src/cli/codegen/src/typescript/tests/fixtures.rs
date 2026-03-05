/* src/cli/codegen/src/typescript/tests/fixtures.rs */

use std::collections::BTreeMap;

use serde_json::json;

use crate::manifest::{Manifest, ProcedureSchema, ProcedureType};

pub(super) fn make_procedure(proc_type: ProcedureType) -> ProcedureSchema {
	ProcedureSchema {
		proc_type,
		input: json!({}),
		output: Some(json!({})),
		chunk_output: None,
		error: None,
		invalidates: None,
		context: None,
		transport: None,
		suppress: None,
		cache: None,
	}
}

pub(super) fn make_manifest_with(procedures: BTreeMap<String, ProcedureSchema>) -> Manifest {
	Manifest {
		version: 2,
		context: BTreeMap::new(),
		procedures,
		channels: BTreeMap::new(),
		transport_defaults: BTreeMap::new(),
	}
}
