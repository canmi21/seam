/* src/cli/skeleton/src/ctr_check/tests.rs */

use super::*;
use serde_json::json;

#[test]
fn matching_html_passes() {
	let template = "<p><!--seam:name--></p>";
	let data = json!({"name": "Alice"});
	let react_html = "<p>Alice</p>";

	let result = verify_ctr_equivalence("/test", react_html, template, &data, "__data");
	assert!(result.is_ok(), "expected Ok, got: {result:?}");
}

#[test]
fn mismatched_style_fails() {
	let template = r#"<span style="background-color:var(--c-text-muted)"></span>"#;
	let data = json!({});
	let react_html = r#"<span style="background-color:#f1e05a"></span>"#;

	let result = verify_ctr_equivalence("/dashboard", react_html, template, &data, "__data");
	assert!(result.is_err());
	let err = result.unwrap_err().to_string();
	assert!(err.contains("CTR equivalence check failed"), "error: {err}");
	assert!(err.contains("/dashboard"), "error should mention route: {err}");
	assert!(err.contains("span"), "error should contain element path: {err}");
}

#[test]
fn mismatched_text_content_fails() {
	let template = "<p><!--seam:msg--></p>";
	let data = json!({"msg": "hello"});
	let react_html = "<p>world</p>";

	let result = verify_ctr_equivalence("/page", react_html, template, &data, "__data");
	assert!(result.is_err());
	let err = result.unwrap_err().to_string();
	assert!(err.contains("CTR equivalence check failed"));
	assert!(err.contains("p"), "error should contain element path: {err}");
}

#[test]
fn empty_data_handles_gracefully() {
	let template = "<div>static content</div>";
	let data = json!({});
	let react_html = "<div>static content</div>";

	let result = verify_ctr_equivalence("/static", react_html, template, &data, "__data");
	assert!(result.is_ok());
}

#[test]
fn resource_hints_stripped_from_inject_output() {
	let template = concat!(
		r#"<!--seam:url:attr:href--><link rel="preload" as="image">"#,
		"<div><!--seam:name--></div>"
	);
	let data = json!({"url": "https://example.com/img.png", "name": "Alice"});
	let react_html = "<div>Alice</div>";

	let result = verify_ctr_equivalence("/test", react_html, template, &data, "__data");
	assert!(result.is_ok(), "resource hints should be stripped: {result:?}");
}

#[test]
fn user_authored_links_preserved() {
	let nodes =
		parse::parse_ctr_tree(r#"<link rel="canonical" href="/page"><div>content</div>"#, "__data");
	assert_eq!(nodes.len(), 2);
	match &nodes[0] {
		parse::CtrNode::Element { tag, attrs, .. } => {
			assert_eq!(tag, "link");
			assert_eq!(attrs.get("rel").unwrap(), "canonical");
		}
		_ => panic!("expected link Element"),
	}
}

#[test]
fn style_binding_full_pipeline() {
	use crate::sentinel_to_slots;

	let sentinel_html = r#"<span style="background-color:%%SEAM:color%%">test</span>"#;
	let template = sentinel_to_slots(sentinel_html);
	assert_eq!(template, "<!--seam:color:style:background-color--><span>test</span>");

	let react_html = r#"<span style="background-color:#f1e05a">test</span>"#;
	let data = json!({"color": "#f1e05a"});

	let result = verify_ctr_equivalence("/test", react_html, &template, &data, "__data");
	assert!(result.is_ok(), "style binding round-trip failed: {result:?}");
}

#[test]
fn style_property_order_mismatch_passes() {
	let template =
		r#"<!--seam:color:style:background-color--><span style="display:inline-block"></span>"#;
	let react_html = r#"<span style="background-color:#f1e05a;display:inline-block"></span>"#;
	let data = json!({"color": "#f1e05a"});

	let result = verify_ctr_equivalence("/test", react_html, template, &data, "__data");
	assert!(result.is_ok(), "style order mismatch should pass: {result:?}");
}

#[test]
fn style_order_with_real_pipeline() {
	use crate::sentinel_to_slots;

	let sentinel_html =
		r#"<span style="background-color:%%SEAM:color%%;display:inline-block">test</span>"#;
	let template = sentinel_to_slots(sentinel_html);

	let react_html = r#"<span style="background-color:#f1e05a;display:inline-block">test</span>"#;
	let data = json!({"color": "#f1e05a"});

	let result = verify_ctr_equivalence("/test", react_html, &template, &data, "__data");
	assert!(result.is_ok(), "dynamic-before-static order should pass: {result:?}");
}

#[test]
fn style_binding_mixed_static_dynamic() {
	use crate::sentinel_to_slots;

	let sentinel_html =
		r#"<span style="display:inline-block;background-color:%%SEAM:color%%">test</span>"#;
	let template = sentinel_to_slots(sentinel_html);
	assert!(template.contains("<!--seam:color:style:background-color-->"));
	assert!(template.contains(r#"style="display:inline-block""#));

	let react_html = r#"<span style="display:inline-block;background-color:#f1e05a">test</span>"#;
	let data = json!({"color": "#f1e05a"});

	let result = verify_ctr_equivalence("/test", react_html, &template, &data, "__data");
	assert!(result.is_ok(), "mixed style binding failed: {result:?}");
}

#[test]
fn attr_order_mismatch_passes() {
	let template = r#"<div id="x" class="red"><!--seam:name--></div>"#;
	let data = json!({"name": "Alice"});
	let react_html = r#"<div class="red" id="x">Alice</div>"#;

	let result = verify_ctr_equivalence("/test", react_html, template, &data, "__data");
	assert!(result.is_ok(), "attr order mismatch should pass: {result:?}");
}

#[test]
fn multi_diff_error_message() {
	let template = r#"<div><p><!--seam:a--></p><span><!--seam:b--></span></div>"#;
	let data = json!({"a": "wrong_a", "b": "wrong_b"});
	let react_html = r#"<div><p>right_a</p><span>right_b</span></div>"#;

	let result = verify_ctr_equivalence("/multi", react_html, template, &data, "__data");
	assert!(result.is_err());
	let err = result.unwrap_err().to_string();
	assert!(err.contains("1."), "should have numbered diff: {err}");
	assert!(err.contains("2."), "should have second numbered diff: {err}");
	assert!(err.contains("p"), "should mention <p> path: {err}");
	assert!(err.contains("span"), "should mention <span> path: {err}");
}

#[test]
fn text_boundary_comment_pipeline_passes() {
	let template = "<p>by <!-- --><!--seam:author--></p>";
	let data = json!({"author": "Alice"});
	let react_html = "<p>by <!-- -->Alice</p>";

	let result = verify_ctr_equivalence("/boundary", react_html, template, &data, "__data");
	assert!(result.is_ok(), "comment-boundary text pipeline failed: {result:?}");
}

#[test]
fn table_row_iteration_pipeline_passes() {
	let template = concat!(
		"<table>",
		"<thead><tr><th>Name</th></tr></thead>",
		"<tbody>",
		"<!--seam:each:rows--><tr><td><!--seam:$.name--></td></tr><!--seam:endeach-->",
		"</tbody>",
		"</table>",
	);
	let data = json!({"rows": [{"name": "Ada"}, {"name": "Lin"}]});
	let react_html = concat!(
		"<table>",
		"<thead><tr><th>Name</th></tr></thead>",
		"<tbody><tr><td>Ada</td></tr><tr><td>Lin</td></tr></tbody>",
		"</table>",
	);

	let result = verify_ctr_equivalence("/table", react_html, template, &data, "__data");
	assert!(result.is_ok(), "table row iteration pipeline failed: {result:?}");
}

#[test]
fn nested_row_boolean_pipeline_passes() {
	let template = concat!(
		"<table><tbody>",
		"<!--seam:each:rows-->",
		"<tr><td><!--seam:$.name--><!--seam:if:$.selected--><strong>Selected</strong><!--seam:endif:$.selected--></td></tr>",
		"<!--seam:endeach-->",
		"</tbody></table>",
	);
	let data = json!({"rows": [
		{"name": "Ada", "selected": true},
		{"name": "Lin", "selected": false}
	]});
	let react_html = concat!(
		"<table><tbody>",
		"<tr><td>Ada<strong>Selected</strong></td></tr>",
		"<tr><td>Lin</td></tr>",
		"</tbody></table>",
	);

	let result = verify_ctr_equivalence("/table-selected", react_html, template, &data, "__data");
	assert!(result.is_ok(), "nested row boolean pipeline failed: {result:?}");
}

#[test]
fn select_options_pipeline_passes() {
	let template = concat!(
		"<label>Priority<select>",
		"<option value=\"\">Choose one</option>",
		"<!--seam:each:choices--><option><!--seam:$.label--></option><!--seam:endeach-->",
		"</select></label>",
	);
	let data = json!({"choices": [{"label": "High"}, {"label": "Low"}]});
	let react_html = concat!(
		"<label>Priority<select>",
		"<option value=\"\">Choose one</option>",
		"<option>High</option><option>Low</option>",
		"</select></label>",
	);

	let result = verify_ctr_equivalence("/select", react_html, template, &data, "__data");
	assert!(result.is_ok(), "select options pipeline failed: {result:?}");
}

#[test]
fn enum_inside_table_row_pipeline_passes() {
	let template = concat!(
		"<table><tbody>",
		"<!--seam:each:rows-->",
		"<tr><td><!--seam:$.name-->",
		"<!--seam:match:$.status-->",
		"<!--seam:when:active--><span>Active</span>",
		"<!--seam:when:paused--><span>Paused</span>",
		"<!--seam:when:archived--><span>Archived</span>",
		"<!--seam:endmatch-->",
		"</td></tr>",
		"<!--seam:endeach-->",
		"</tbody></table>",
	);
	let data = json!({"rows": [
		{"name": "Ada", "status": "active"},
		{"name": "Lin", "status": "archived"}
	]});
	let react_html = concat!(
		"<table><tbody>",
		"<tr><td>Ada<span>Active</span></td></tr>",
		"<tr><td>Lin<span>Archived</span></td></tr>",
		"</tbody></table>",
	);

	let result = verify_ctr_equivalence("/table-enum", react_html, template, &data, "__data");
	assert!(result.is_ok(), "enum-inside-row pipeline failed: {result:?}");
}

#[test]
fn watches_table_pipeline_with_two_runtime_items() {
	use crate::{Axis, extract_template, sentinel_to_slots};

	let axes = vec![Axis {
		path: "watches".to_string(),
		kind: "array".to_string(),
		values: vec![json!("populated"), json!("empty")],
	}];

	let populated = sentinel_to_slots(concat!(
		"<table>",
		"<thead><tr>",
		"<th>Brand</th><th>Model</th><th>Reference</th><th>Price</th><th>Status</th>",
		"</tr></thead>",
		"<tbody><tr>",
		"<td>%%SEAM:watches.$.brand%%</td>",
		"<td>%%SEAM:watches.$.model%%</td>",
		"<td>Ref <!-- -->%%SEAM:watches.$.referenceNumber%%</td>",
		"<td>Price <!-- -->%%SEAM:watches.$.formattedPrice%%</td>",
		"<td>Status: %%SEAM:watches.$.availabilityLabel%%</td>",
		"</tr></tbody>",
		"</table>",
	));
	let empty = sentinel_to_slots(concat!(
		"<table>",
		"<thead><tr>",
		"<th>Brand</th><th>Model</th><th>Reference</th><th>Price</th><th>Status</th>",
		"</tr></thead>",
		"<tbody></tbody>",
		"</table>",
	));
	let template = extract_template(&axes, &[populated, empty]);

	let data = json!({
		"watches": [
			{
				"brand": "Cartier",
				"model": "Santos de Cartier",
				"referenceNumber": "WSSA0018",
				"formattedPrice": "USD 7,200",
				"availabilityLabel": "Available"
			},
			{
				"brand": "Omega",
				"model": "Seamaster 300 Master Co-Axial",
				"referenceNumber": "234.30.41.21.01.001",
				"formattedPrice": "USD 6,400",
				"availabilityLabel": "Available"
			}
		]
	});

	let react_html = concat!(
		"<table>",
		"<thead><tr>",
		"<th>Brand</th><th>Model</th><th>Reference</th><th>Price</th><th>Status</th>",
		"</tr></thead>",
		"<tbody>",
		"<tr>",
		"<td>Cartier</td>",
		"<td>Santos de Cartier</td>",
		"<td>Ref <!-- -->WSSA0018</td>",
		"<td>Price <!-- -->USD 7,200</td>",
		"<td>Status: Available</td>",
		"</tr>",
		"<tr>",
		"<td>Omega</td>",
		"<td>Seamaster 300 Master Co-Axial</td>",
		"<td>Ref <!-- -->234.30.41.21.01.001</td>",
		"<td>Price <!-- -->USD 6,400</td>",
		"<td>Status: Available</td>",
		"</tr>",
		"</tbody>",
		"</table>",
	);

	let result = verify_ctr_equivalence("/dashboard/watches", react_html, &template, &data, "__data");
	assert!(result.is_ok(), "watches pipeline failed: {result:?}\nTemplate:\n{template}");
}

#[test]
fn watches_static_admin_table_branch_should_preserve_single_table_shell() {
	use crate::{Axis, extract_template, sentinel_to_slots};

	let axes = vec![Axis {
		path: "watches.watches".to_string(),
		kind: "array".to_string(),
		values: vec![json!("populated"), json!("empty")],
	}];

	let populated = sentinel_to_slots(concat!(
		r#"<div class="overflow-hidden rounded-2xl border border-border/70 bg-card">"#,
		r#"<div data-slot="table-container" class="relative w-full overflow-x-auto">"#,
		r#"<table data-slot="table" class="w-full caption-bottom text-sm">"#,
		"<thead><tr>",
		"<th>Brand</th><th>Model</th><th>Ref#</th><th>Price</th><th>Condition</th><th>Status</th><th>Actions</th>",
		"</tr></thead>",
		"<tbody><tr>",
		"<td>%%SEAM:watches.watches.$.brand%%</td>",
		"<td>%%SEAM:watches.watches.$.model%%</td>",
		"<td>%%SEAM:watches.watches.$.referenceNumber%%</td>",
		"<td>%%SEAM:watches.watches.$.formattedPrice%%</td>",
		"<td>%%SEAM:watches.watches.$.condition%%</td>",
		"<td><span>%%SEAM:watches.watches.$.availabilityLabel%%</span></td>",
		"<td><div><button>Edit</button><button>Delete</button></div></td>",
		"</tr></tbody></table></div></div>",
	));
	let empty = sentinel_to_slots(concat!(
		r#"<div class="overflow-hidden rounded-2xl border border-border/70 bg-card">"#,
		"<p>No watches found.</p>",
		"</div>",
	));

	let template = extract_template(&axes, &[populated, empty]);
	let data = json!({
		"watches": {
			"watches": [
				{
					"brand": "Cartier",
					"model": "Santos de Cartier",
					"referenceNumber": "WSSA0018",
					"formattedPrice": "USD 7,200",
					"condition": "Excellent",
					"availabilityLabel": "Available"
				},
				{
					"brand": "Omega",
					"model": "Seamaster 300 Master Co-Axial",
					"referenceNumber": "234.30.41.21.01.001",
					"formattedPrice": "USD 6,400",
					"condition": "Excellent",
					"availabilityLabel": "Available"
				}
			]
		}
	});

	let react_html = concat!(
		r#"<div class="overflow-hidden rounded-2xl border border-border/70 bg-card">"#,
		r#"<div data-slot="table-container" class="relative w-full overflow-x-auto">"#,
		r#"<table data-slot="table" class="w-full caption-bottom text-sm">"#,
		"<thead><tr>",
		"<th>Brand</th><th>Model</th><th>Ref#</th><th>Price</th><th>Condition</th><th>Status</th><th>Actions</th>",
		"</tr></thead>",
		"<tbody>",
		"<tr>",
		"<td>Cartier</td>",
		"<td>Santos de Cartier</td>",
		"<td>WSSA0018</td>",
		"<td>USD 7,200</td>",
		"<td>Excellent</td>",
		"<td><span>Available</span></td>",
		"<td><div><button>Edit</button><button>Delete</button></div></td>",
		"</tr>",
		"<tr>",
		"<td>Omega</td>",
		"<td>Seamaster 300 Master Co-Axial</td>",
		"<td>234.30.41.21.01.001</td>",
		"<td>USD 6,400</td>",
		"<td>Excellent</td>",
		"<td><span>Available</span></td>",
		"<td><div><button>Edit</button><button>Delete</button></div></td>",
		"</tr>",
		"</tbody></table></div></div>",
	);

	let result = verify_ctr_equivalence("/dashboard/watches", react_html, &template, &data, "__data");
	assert!(
		result.is_ok(),
		"static admin watches branch should preserve a single table shell\nresult: {result:?}\n\nTemplate:\n{template}"
	);
}

#[test]
fn table_container_array_with_empty_fallback_should_preserve_single_table_shell() {
	use crate::{Axis, extract_template, sentinel_to_slots};

	let axes = vec![Axis {
		path: "items".to_string(),
		kind: "array".to_string(),
		values: vec![json!("populated"), json!("empty")],
	}];

	let populated = sentinel_to_slots(concat!(
		r#"<div class="frame">"#,
		r#"<div data-slot="table-container" class="table-shell">"#,
		r#"<table class="grid">"#,
		"<thead><tr><th>A</th><th>B</th><th>Static</th></tr></thead>",
		"<tbody><tr>",
		"<td>%%SEAM:items.$.a%%</td>",
		"<td>%%SEAM:items.$.b%%</td>",
		"<td><button>Edit</button></td>",
		"</tr></tbody></table></div></div>",
	));
	let empty = sentinel_to_slots(r#"<div class="frame"><p>No items.</p></div>"#);
	let template = extract_template(&axes, &[populated, empty]);

	let data = json!({
		"items": [
			{"a": "one", "b": "first"},
			{"a": "two", "b": "second"}
		]
	});
	let react_html = concat!(
		r#"<div class="frame">"#,
		r#"<div data-slot="table-container" class="table-shell">"#,
		r#"<table class="grid">"#,
		"<thead><tr><th>A</th><th>B</th><th>Static</th></tr></thead>",
		"<tbody>",
		"<tr><td>one</td><td>first</td><td><button>Edit</button></td></tr>",
		"<tr><td>two</td><td>second</td><td><button>Edit</button></td></tr>",
		"</tbody></table></div></div>",
	);

	let result = verify_ctr_equivalence("/minimal-table", react_html, &template, &data, "__data");
	assert!(
		result.is_ok(),
		"table container array should keep a single table shell\nresult: {result:?}\n\nTemplate:\n{template}"
	);
}
