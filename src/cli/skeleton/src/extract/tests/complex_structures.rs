/* src/cli/skeleton/src/extract/tests/complex_structures.rs */

use super::*;

#[test]
fn extract_table_rows_without_wrapping_table_in_each() {
	let axes = vec![make_axis("rows", "array", vec![json!("populated"), json!("empty")])];
	let variants = vec![
		concat!(
			"<table>",
			"<thead><tr><th>Name</th></tr></thead>",
			"<tbody><tr><td><!--seam:rows.$.name--></td></tr></tbody>",
			"</table>",
		)
		.to_string(),
		concat!("<table>", "<thead><tr><th>Name</th></tr></thead>", "<tbody></tbody>", "</table>",)
			.to_string(),
	];

	let result = extract_template(&axes, &variants);

	assert!(result.contains("<thead><tr><th>Name</th></tr></thead>"), "missing thead in:\n{result}");
	assert!(result.contains("<!--seam:each:rows-->"), "missing each:rows in:\n{result}");
	assert!(result.contains("<!--seam:$.name-->"), "missing $.name in:\n{result}");
	assert!(result.contains("<!--seam:endeach-->"), "missing endeach in:\n{result}");
	assert!(!result.contains("<!--seam:each:rows--><table"), "table wrapped by each in:\n{result}");
	assert!(!result.contains("<!--seam:each:rows--><thead"), "thead wrapped by each in:\n{result}");
	assert!(!result.contains("rows.$."), "leaked full row path in:\n{result}");
}

#[test]
fn extract_table_rows_with_empty_state_keeps_table_shell_static() {
	let axes = vec![make_axis("rows", "array", vec![json!("populated"), json!("empty")])];
	let variants = vec![
		concat!(
			"<section>",
			"<h2>Users</h2>",
			"<table>",
			"<thead><tr><th>Name</th></tr></thead>",
			"<tbody><tr><td><!--seam:rows.$.name--></td></tr></tbody>",
			"</table>",
			"</section>",
		)
		.to_string(),
		"<section><h2>Users</h2><p>No rows</p></section>".to_string(),
	];

	let result = extract_template(&axes, &variants);

	assert!(result.contains("<!--seam:if:rows-->"), "missing if:rows in:\n{result}");
	assert!(result.contains("<!--seam:each:rows-->"), "missing each:rows in:\n{result}");
	assert!(result.contains("<!--seam:else-->"), "missing else in:\n{result}");
	assert!(result.contains("<p>No rows</p>"), "missing fallback in:\n{result}");
	assert!(result.contains("<!--seam:endif:rows-->"), "missing endif:rows in:\n{result}");
	assert!(result.contains("<h2>Users</h2>"), "missing title in:\n{result}");
	assert!(!result.contains("<!--seam:each:rows--><table"), "table wrapped by each in:\n{result}");
}

#[test]
fn extract_static_siblings_around_list_body_stay_outside_each() {
	let axes = vec![make_axis("posts", "array", vec![json!("populated"), json!("empty")])];
	let variants = vec![
		concat!(
			"<section>",
			"<h2>Recent Posts</h2>",
			"<ul><li><!--seam:posts.$.title--></li></ul>",
			"<p class=\"summary\">Static footer</p>",
			"</section>",
		)
		.to_string(),
		concat!(
			"<section>",
			"<h2>Recent Posts</h2>",
			"<ul></ul>",
			"<p class=\"summary\">Static footer</p>",
			"</section>",
		)
		.to_string(),
	];

	let result = extract_template(&axes, &variants);

	assert!(result.contains("<h2>Recent Posts</h2>"), "missing heading in:\n{result}");
	assert!(result.contains("<p class=\"summary\">Static footer</p>"), "missing footer in:\n{result}");
	assert!(result.contains("<!--seam:each:posts-->"), "missing each:posts in:\n{result}");
	assert!(result.contains("<!--seam:$.title-->"), "missing $.title in:\n{result}");
	assert!(!result.contains("<!--seam:each:posts--><section"), "section wrapped by each in:\n{result}");
	assert!(!result.contains("posts.$."), "leaked nested post path in:\n{result}");
}

#[test]
fn extract_table_row_with_nested_boolean_stays_scoped_to_row() {
	let axes = vec![
		make_axis("rows", "array", vec![json!("populated"), json!("empty")]),
		make_axis("rows.$.selected", "boolean", vec![json!(true), json!(false)]),
	];

	fn make(populated: bool, selected: bool) -> String {
		if !populated {
			return concat!(
				"<table>",
				"<thead><tr><th>Name</th></tr></thead>",
				"<tbody></tbody>",
				"</table>",
			)
			.to_string();
		}

		let badge = if selected { "<strong>Selected</strong>" } else { "" };
		format!(
			concat!(
				"<table>",
				"<thead><tr><th>Name</th></tr></thead>",
				"<tbody><tr><td><!--seam:rows.$.name-->{}</td></tr></tbody>",
				"</table>",
			),
			badge,
		)
	}

	let mut variants = Vec::new();
	for &populated in &[true, false] {
		for &selected in &[true, false] {
			variants.push(make(populated, selected));
		}
	}

	let result = extract_template(&axes, &variants);

	assert!(result.contains("<!--seam:each:rows-->"), "missing each:rows in:\n{result}");
	assert!(result.contains("<!--seam:if:$.selected-->"), "missing if:$.selected in:\n{result}");
	assert!(result.contains("<strong>Selected</strong>"), "missing selected badge in:\n{result}");
	assert!(result.contains("<!--seam:endif:$.selected-->"), "missing endif:$.selected in:\n{result}");
	assert!(!result.contains("<!--seam:each:rows--><table"), "table wrapped by each in:\n{result}");
	assert!(!result.contains("rows.$."), "leaked full row path in:\n{result}");
}

#[test]
fn extract_nested_list_inside_article_repeats_only_article_body() {
	let axes = vec![make_axis("articles", "array", vec![json!("populated"), json!("empty")])];
	let variants = vec![
		concat!(
			"<main>",
			"<header><h1>Feed</h1></header>",
			"<article>",
			"<h2><!--seam:articles.$.title--></h2>",
			"<ul><li>meta</li></ul>",
			"</article>",
			"<footer>Done</footer>",
			"</main>",
		)
		.to_string(),
		"<main><header><h1>Feed</h1></header><footer>Done</footer></main>".to_string(),
	];

	let result = extract_template(&axes, &variants);

	assert!(result.contains("<header><h1>Feed</h1></header>"), "missing header in:\n{result}");
	assert!(result.contains("<footer>Done</footer>"), "missing footer in:\n{result}");
	assert!(result.contains("<!--seam:each:articles-->"), "missing each:articles in:\n{result}");
	assert!(result.contains("<!--seam:$.title-->"), "missing $.title in:\n{result}");
	assert!(!result.contains("<!--seam:each:articles--><main"), "main wrapped by each in:\n{result}");
	assert!(!result.contains("articles.$."), "leaked full article path in:\n{result}");
}

#[test]
fn extract_repeating_tbody_keeps_table_caption_and_head_static() {
	let axes = vec![make_axis("sections", "array", vec![json!("populated"), json!("empty")])];
	let variants = vec![
		concat!(
			"<table>",
			"<caption>Leaderboard</caption>",
			"<thead><tr><th>Name</th></tr></thead>",
			"<tbody><tr><td><!--seam:sections.$.name--></td></tr></tbody>",
			"</table>",
		)
		.to_string(),
		concat!(
			"<table>",
			"<caption>Leaderboard</caption>",
			"<thead><tr><th>Name</th></tr></thead>",
			"</table>",
		)
		.to_string(),
	];

	let result = extract_template(&axes, &variants);

	assert!(result.contains("<caption>Leaderboard</caption>"), "missing caption in:\n{result}");
	assert!(result.contains("<thead><tr><th>Name</th></tr></thead>"), "missing head in:\n{result}");
	assert!(result.contains("<!--seam:each:sections-->"), "missing each:sections in:\n{result}");
	assert!(result.contains("<!--seam:$.name-->"), "missing $.name in:\n{result}");
	assert!(!result.contains("<!--seam:each:sections--><table"), "table wrapped by each in:\n{result}");
	assert!(!result.contains("<!--seam:each:sections--><caption"), "caption wrapped by each in:\n{result}");
	assert!(!result.contains("sections.$."), "leaked full section path in:\n{result}");
}

#[test]
fn extract_select_options_keeps_placeholder_static() {
	let axes = vec![make_axis("choices", "array", vec![json!("populated"), json!("empty")])];
	let variants = vec![
		concat!(
			"<label>",
			"Priority",
			"<select>",
			"<option value=\"\">Choose one</option>",
			"<option><!--seam:choices.$.label--></option>",
			"</select>",
			"</label>",
		)
		.to_string(),
		concat!(
			"<label>",
			"Priority",
			"<select>",
			"<option value=\"\">Choose one</option>",
			"</select>",
			"</label>",
		)
		.to_string(),
	];

	let result = extract_template(&axes, &variants);

	assert!(result.contains("<option value=\"\">Choose one</option>"), "missing placeholder in:\n{result}");
	assert!(result.contains("<!--seam:each:choices-->"), "missing each:choices in:\n{result}");
	assert!(result.contains("<!--seam:$.label-->"), "missing $.label in:\n{result}");
	assert!(!result.contains("<!--seam:each:choices--><label"), "label wrapped by each in:\n{result}");
	assert!(!result.contains("choices.$."), "leaked full choice path in:\n{result}");
}

#[test]
fn extract_description_list_pair_repeats_dt_and_dd_together() {
	let axes = vec![make_axis("facts", "array", vec![json!("populated"), json!("empty")])];
	let variants = vec![
		"<dl><dt><!--seam:facts.$.term--></dt><dd><!--seam:facts.$.value--></dd></dl>".to_string(),
		"<dl></dl>".to_string(),
	];

	let result = extract_template(&axes, &variants);

	assert!(result.contains("<dl>"), "missing dl in:\n{result}");
	assert!(result.contains("<!--seam:each:facts-->"), "missing each:facts in:\n{result}");
	assert!(result.contains("<!--seam:$.term-->"), "missing $.term in:\n{result}");
	assert!(result.contains("<!--seam:$.value-->"), "missing $.value in:\n{result}");
	assert!(result.contains("<!--seam:endeach-->"), "missing endeach in:\n{result}");
	assert!(!result.contains("facts.$."), "leaked full fact path in:\n{result}");
}

#[test]
fn extract_table_row_text_boundary_stays_inside_row_body() {
	let axes = vec![make_axis("rows", "array", vec![json!("populated"), json!("empty")])];
		let variants = vec![
			concat!(
				"<table><tbody>",
				"<tr><td>by <!-- --><!--seam:rows.$.author--></td></tr>",
				"</tbody></table>",
			)
			.to_string(),
			"<table><tbody></tbody></table>".to_string(),
		];

	let result = extract_template(&axes, &variants);

	assert!(result.contains("<!--seam:each:rows-->"), "missing each:rows in:\n{result}");
	assert!(result.contains("<!-- -->"), "missing preserved React boundary in:\n{result}");
	assert!(result.contains("<!--seam:$.author-->"), "missing $.author in:\n{result}");
	assert!(!result.contains("rows.$."), "leaked full row path in:\n{result}");
}

#[test]
fn extract_enum_inside_table_row_keeps_row_scope() {
	let axes = vec![
		make_axis("rows", "array", vec![json!("populated"), json!("empty")]),
		make_axis("rows.$.status", "enum", vec![json!("active"), json!("paused"), json!("archived")]),
	];

	fn make(populated: bool, status: &str) -> String {
		if !populated {
			return "<table><tbody></tbody></table>".to_string();
		}

		let badge = match status {
			"active" => "<span>Active</span>",
			"paused" => "<span>Paused</span>",
			_ => "<span>Archived</span>",
		};

		format!("<table><tbody><tr><td><!--seam:rows.$.name-->{badge}</td></tr></tbody></table>")
	}

	let mut variants = Vec::new();
	for &populated in &[true, false] {
		for status in &["active", "paused", "archived"] {
			variants.push(make(populated, status));
		}
	}

	let result = extract_template(&axes, &variants);

	assert!(result.contains("<!--seam:each:rows-->"), "missing each:rows in:\n{result}");
	assert!(result.contains("<!--seam:match:$.status-->"), "missing match:$.status in:\n{result}");
	assert!(result.contains("<!--seam:when:active-->"), "missing when:active in:\n{result}");
	assert!(result.contains("<!--seam:when:paused-->"), "missing when:paused in:\n{result}");
	assert!(result.contains("<!--seam:when:archived-->"), "missing when:archived in:\n{result}");
	assert!(result.contains("<!--seam:endmatch-->"), "missing endmatch in:\n{result}");
	assert!(!result.contains("<!--seam:each:rows--><table"), "table wrapped by each in:\n{result}");
	assert!(!result.contains("rows.$."), "leaked full row path in:\n{result}");
}
