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

/// The written pass refuses `<svelte:head>`, so where a case has one there is no second opinion
/// to hold the render pass against. That is the oracle running out, not a gap: it was always
/// going to stop covering what came after it. See spec/pipeline.md.
fn writes_to_the_head(name: &str) -> bool {
	let committed: serde_json::Value =
		serde_json::from_str(&read(&format!("conformance/cases/{name}.ir.json"))).expect("ir");
	committed["ir"]["head"].as_array().is_some_and(|head| !head.is_empty())
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
		if writes_to_the_head(&name) {
			continue;
		}
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
	let nodes = json["body"].as_array().expect("body");
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

/// The head is assembled now, but blocks are matched by walking one string in document order and
/// the head is a second string ordered its own way. Refused until a block records which stream it
/// belongs to.
#[test]
fn a_block_inside_the_head_is_refused_while_blocks_are_matched_by_order() {
	let skeleton: Skeleton = serde_json::from_str(
		r#"{"html":"<!--[--><div></div><!--]-->",
		    "head":"<!--3e142l--><!--[0--><meta name=\"a\" content=\"1\"/><!--]-->",
		    "alternates":{},"holes":[],"blocks":[]}"#,
	)
	.expect("a skeleton");
	let error = assemble("c", &skeleton).expect_err("a block in the head is not placeable yet");
	assert!(error.contains("head"), "{error}");
}

/// A head that holds no expression produces no sentinel, so the hole check has nothing to
/// disagree about. Reading the stream is what makes its content reachable at all.
#[test]
fn a_static_head_becomes_nodes_rather_than_nothing() {
	let skeleton: Skeleton = serde_json::from_str(
		r#"{"html":"<!--[--><div></div><!--]-->","head":"<!--3e142l--><title>T</title>",
		    "alternates":{},"holes":[],"blocks":[]}"#,
	)
	.expect("a skeleton");
	let compiled = assemble("c", &skeleton).expect("a static head is carried");
	assert_eq!(
		serde_json::to_value(&compiled.ir.head).expect("json"),
		serde_json::json!([{ "t": "static", "s": "<!--3e142l--><title>T</title>" }])
	);
}

/// The written pass walks the markup, so it refuses a node it does not know. This pass reads a
/// rendered string and has no notion of a node, so the same guarantee has to be stated in what it
/// does see: a sentinel it never gets back is content that went somewhere it does not look.
/// `<svelte:head>` is the shape that found it -- `render()` returns a head as well as a body, and
/// a title in it compiled without complaint and then did not exist.
#[test]
fn a_hole_the_render_never_returns_is_refused_rather_than_dropped() {
	let skeleton: Skeleton = serde_json::from_str(
		r#"{"html":"<!--[--><div>%%s1%%</div><!--]-->","alternates":{},
		    "holes":[{"expression":"p.title","raw":false},{"expression":"p.name","raw":false}],
		    "blocks":[]}"#,
	)
	.expect("a skeleton");
	let error = assemble("c", &skeleton).expect_err("the first hole is nowhere in the render");
	assert!(error.contains("p.title"), "{error}");
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
		if writes_to_the_head(&name) {
			continue;
		}

		let written = lower(&bundle).unwrap_or_else(|e| panic!("{name}: {e}")).ir;
		let split = assemble(&name, &skeleton).unwrap_or_else(|e| panic!("{name}: {e}")).ir;
		assert_eq!(
			serde_json::to_value(&split).expect("json"),
			serde_json::to_value(&written).expect("json"),
			"{name}: assembling the render disagrees with writing the bytes"
		);
		checked += 1;
	}
	assert!(checked > 0, "no rendered cases found");
}
