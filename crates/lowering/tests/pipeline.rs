//! Closes the loop the rewrite is built around.
//!
//! Three links, each guarded by one check: `pkgs/ast` holds Svelte's AST to a fixture, this
//! holds lowering to the IR the specification describes, and `pkgs/injector` holds that IR to
//! Svelte's own server output. Together they say that a component compiled here renders the
//! bytes Svelte would have rendered, without any of Svelte running at request time.

use lowering::{assemble, assemble::Skeleton, lower, markup::Bundle};

fn read(relative: &str) -> String {
	let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").join(relative);
	std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()))
}

/// The specification carries one of these IRs as its worked example, so it is the expectation
/// rather than a copy of one.
fn ir_from_spec() -> serde_json::Value {
	let spec = read("spec/ir.md");
	let start = spec.find("```json").expect("spec/ir.md has no json block") + "```json\n".len();
	let rest = &spec[start..];
	let end = rest.find("```").expect("unterminated json block");
	serde_json::from_str(&rest[..end]).expect("the json block does not parse")
}

fn bundle_of(source: &str) -> Bundle {
	serde_json::from_str(source).expect("a bundle")
}

/// One entry with no imports, for checking what lowering refuses.
fn single(markup: &str) -> Bundle {
	bundle_of(&format!(
		r#"{{"entry":"c","components":{{"c":{{"markup":{markup},"imports":{{}}}}}}}}"#
	))
}

/// Every case, not just the one the specification carries. Adding a case is adding two files.
#[test]
fn lowering_reproduces_every_committed_ir() {
	let cases = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../conformance/cases");
	let mut checked = 0;
	for entry in std::fs::read_dir(&cases).expect("cases") {
		let path = entry.expect("entry").path();
		if path.extension().is_none_or(|e| e != "svelte") {
			continue;
		}
		let name = path.file_stem().expect("stem").to_string_lossy().into_owned();
		let bundle: Bundle =
			serde_json::from_str(&read(&format!("conformance/cases/{name}.markup.json")))
				.unwrap_or_else(|e| panic!("{name} markup: {e}"));
		let produced =
			serde_json::to_value(lower(&bundle).unwrap_or_else(|e| panic!("{name}: {e}"))).expect("json");
		let committed: serde_json::Value =
			serde_json::from_str(&read(&format!("conformance/cases/{name}.ir.json")))
				.unwrap_or_else(|e| panic!("{name} ir: {e}"));
		assert_eq!(produced, committed, "{name} no longer lowers to its committed IR");
		checked += 1;
	}
	assert!(checked > 0, "no cases found");
}

#[test]
fn the_specification_carries_the_ir_lowering_produces() {
	let committed: serde_json::Value =
		serde_json::from_str(&read("conformance/cases/product.ir.json")).expect("ir");
	assert_eq!(committed["ir"], ir_from_spec());
}

#[test]
fn an_expression_that_is_not_a_path_becomes_a_derivation() {
	let bundle = single(r#"[{"k":"if","test":"price > 10","consequent":[],"alternate":null}]"#);
	let compiled = lower(&bundle).expect("a comparison is derived, not refused");
	let [derivation] = compiled.derivations.as_slice() else {
		panic!("expected one derivation, got {:?}", compiled.derivations);
	};
	assert_eq!(derivation.expression, "price > 10");
	let json = serde_json::to_value(&compiled.ir).expect("json");
	let nodes = json["nodes"].as_array().expect("nodes");
	let block = nodes.iter().find(|n| n["t"] == "if").expect("an if node");
	assert_eq!(block["branches"][0]["test"], serde_json::json!(derivation.name));
}

/// A derivation runs once per request, so a value that differs per iteration has nowhere to go.
#[test]
fn an_expression_inside_an_each_block_is_refused() {
	let bundle = single(
		r#"[{"k":"each","source":"p.xs","item":"x","index":null,"key":null,"fallback":null,
		     "body":[{"k":"expr","src":"x.toUpperCase()"}]}]"#,
	);
	let error = lower(&bundle).expect_err("per-item derivation is not available");
	assert!(error.contains("each block"), "{error}");
}

#[test]
fn a_node_lowering_does_not_know_is_refused_rather_than_dropped() {
	let bundle =
		single(r#"[{"k":"unsupported","type":"SvelteComponent","src":"<svelte:component />"}]"#);
	let error = lower(&bundle).expect_err("an escape hatch is not handled yet");
	assert!(error.contains("SvelteComponent"), "{error}");
}

#[test]
fn a_component_the_bundle_does_not_carry_is_named() {
	let bundle = bundle_of(
		r#"{"entry":"c","components":{"c":{"markup":[{"k":"component","name":"Gone","props":[],"body":[]}],"imports":{"Gone":"missing"}}}}"#,
	);
	let error = lower(&bundle).expect_err("the child is not in the bundle");
	assert!(error.contains("missing"), "{error}");
}

#[test]
fn a_cycle_is_an_error_rather_than_a_hang() {
	let bundle = bundle_of(
		r#"{"entry":"a","components":{
			"a":{"markup":[{"k":"component","name":"B","props":[],"body":[]}],"imports":{"B":"b"}},
			"b":{"markup":[{"k":"component","name":"A","props":[],"body":[]}],"imports":{"A":"a"}}
		}}"#,
	);
	let error = lower(&bundle).expect_err("a and b import each other");
	assert!(error.contains("cycle"), "{error}");
}

/// Two ways of producing the same IR, held to each other. One writes Svelte's anchors from rules
/// read out of its code generator; the other splits what Svelte actually rendered. Where both can
/// run, they must agree, and that agreement is what licenses replacing the first with the second.
#[test]
fn assembling_a_render_agrees_with_writing_the_bytes() {
	let cases = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../conformance/cases");
	let mut checked = 0;
	for entry in std::fs::read_dir(&cases).expect("cases") {
		let path = entry.expect("entry").path();
		if path.extension().is_none_or(|e| e != "svelte") {
			continue;
		}
		let name = path.file_stem().expect("stem").to_string_lossy().into_owned();
		let rendered = cases.join(format!("{name}.skeleton.json"));
		if !rendered.exists() {
			continue;
		}

		let skeleton: Skeleton =
			serde_json::from_str(&read(&format!("conformance/cases/{name}.skeleton.json")))
				.unwrap_or_else(|e| panic!("{name} skeleton: {e}"));
		let bundle: Bundle =
			serde_json::from_str(&read(&format!("conformance/cases/{name}.markup.json")))
				.unwrap_or_else(|e| panic!("{name} markup: {e}"));

		let written = lower(&bundle).unwrap_or_else(|e| panic!("{name}: {e}")).ir;
		let split = assemble(&name, &skeleton).unwrap_or_else(|e| panic!("{name}: {e}"));
		assert_eq!(
			serde_json::to_value(&split).expect("json"),
			serde_json::to_value(&written).expect("json"),
			"{name}: assembling the render disagrees with writing the bytes"
		);
		checked += 1;
	}
	assert!(checked > 0, "no rendered cases found");
}
