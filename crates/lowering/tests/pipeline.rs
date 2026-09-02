//! Closes the loop the rewrite is built around.
//!
//! Three links, each guarded by one check: `pkgs/ast` holds Svelte's AST to a fixture, this
//! holds lowering to the IR the specification describes, and `pkgs/injector` holds that IR to
//! Svelte's own server output. Together they say that a component compiled here renders the
//! bytes Svelte would have rendered, without any of Svelte running at request time.

use seam_lowering::{lower, markup::Markup};

fn read(relative: &str) -> String {
	let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").join(relative);
	std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()))
}

/// The specification carries the IR as its worked example, so it is the expectation rather than
/// a copy of one. An example edited into something lowering does not produce fails here.
fn ir_from_spec() -> serde_json::Value {
	let spec = read("spec/ir.md");
	let start = spec.find("```json").expect("spec/ir.md has no json block") + "```json\n".len();
	let rest = &spec[start..];
	let end = rest.find("```").expect("unterminated json block");
	serde_json::from_str(&rest[..end]).expect("the json block does not parse")
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
		let component = {
			let mut chars = name.chars();
			let first = chars.next().expect("a name").to_uppercase().to_string();
			format!("{first}{}", chars.as_str())
		};
		let markup: Markup =
			serde_json::from_str(&read(&format!("conformance/cases/{name}.markup.json")))
				.unwrap_or_else(|e| panic!("{name} markup: {e}"));
		let produced =
			serde_json::to_value(lower(&component, &markup).unwrap_or_else(|e| panic!("{name}: {e}")))
				.expect("json");
		let committed: serde_json::Value =
			serde_json::from_str(&read(&format!("conformance/cases/{name}.ir.json")))
				.unwrap_or_else(|e| panic!("{name} ir: {e}"));
		assert_eq!(produced, committed, "{name} no longer lowers to its committed IR");
		checked += 1;
	}
	assert!(checked > 0, "no cases found");
}

/// The specification carries one of those IRs as its worked example, so it is the expectation
/// rather than a copy of one. An example edited into something lowering does not produce fails.
#[test]
fn the_specification_carries_the_ir_lowering_produces() {
	let committed: serde_json::Value =
		serde_json::from_str(&read("conformance/cases/product.ir.json")).expect("ir");
	assert_eq!(committed, ir_from_spec());
}

#[test]
fn an_expression_that_is_not_a_path_is_refused() {
	let markup: Markup = serde_json::from_str(
		r#"{"markup":[{"k":"if","test":"price > 10","consequent":[],"alternate":null}]}"#,
	)
	.expect("markup");
	let error = lower("C", &markup).expect_err("a comparison is not a data path");
	assert!(error.contains("not a data path"), "{error}");
}

#[test]
fn a_node_lowering_does_not_know_is_refused_rather_than_dropped() {
	let markup: Markup =
		serde_json::from_str(r#"{"markup":[{"k":"unsupported","type":"Component","src":"<Foo />"}]}"#)
			.expect("markup");
	let error = lower("C", &markup).expect_err("a component is not handled yet");
	assert!(error.contains("Component"), "{error}");
}
