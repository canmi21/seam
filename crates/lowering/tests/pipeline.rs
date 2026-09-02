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

#[test]
fn lowering_produces_the_ir_the_specification_describes() {
	let markup: Markup =
		serde_json::from_str(&read("pkgs/ast/fixtures/product.markup.json")).expect("fixture");
	let produced = serde_json::to_value(lower("Product", &markup).expect("lowering")).expect("json");
	assert_eq!(produced, ir_from_spec());
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
