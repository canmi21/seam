/* src/cli/skeleton/src/slot_paths.rs */

// Extract data-referencing slot paths from templates for schema narrowing.
// Two regex patterns capture data access while ignoring structural markers.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::OnceLock;

use regex::Regex;

/// Text, html, attr, and style data slots.
fn data_slot_re() -> &'static Regex {
	static RE: OnceLock<Regex> = OnceLock::new();
	RE.get_or_init(|| {
		Regex::new(r"<!--seam:([^:>]+(?:\.[^:>]+)*)(?::(?:html|attr:[^>]+|style:[^>]+))?-->")
			.expect("valid regex")
	})
}

/// Directive data paths: if, each, match.
fn directive_re() -> &'static Regex {
	static RE: OnceLock<Regex> = OnceLock::new();
	RE.get_or_init(|| {
		Regex::new(r"<!--seam:(?:if|each|match):([^:>]+(?:\.[^:>]+)*)-->").expect("valid regex")
	})
}

/// Structural markers that pattern 1 may capture but are not data references.
const NON_DATA_MARKERS: &[&str] =
	&["outlet", "else", "endeach", "endmatch", "page-styles", "page-scripts", "prefetch"];

/// Extract all data-referencing slot paths from a template.
pub fn collect_slot_paths(template: &str) -> BTreeSet<String> {
	let mut paths = BTreeSet::new();

	for cap in data_slot_re().captures_iter(template) {
		let path = &cap[1];
		if !NON_DATA_MARKERS.contains(&path) {
			paths.insert(path.to_string());
		}
	}

	for cap in directive_re().captures_iter(template) {
		paths.insert(cap[1].to_string());
	}

	paths
}

/// Group paths by loader key (first segment), stripping the loader key prefix.
/// Returns loader_key -> set of field paths within that loader's data.
///
/// - `user.name` -> loader `user`, field `"name"`
/// - `repos.$.title` -> loader `repos`, fields `{"$", "$.title"}`
/// - `user` (no dot) -> loader `user`, field `""` (entire value used)
pub fn group_by_loader(paths: &BTreeSet<String>) -> BTreeMap<String, BTreeSet<String>> {
	let mut groups: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();

	for path in paths {
		if let Some(dot_pos) = path.find('.') {
			let loader_key = &path[..dot_pos];
			let remaining = &path[dot_pos + 1..];
			let entry = groups.entry(loader_key.to_string()).or_default();
			entry.insert(remaining.to_string());
			// Array iteration paths: add standalone $ to preserve array structure
			if remaining.starts_with("$.") {
				entry.insert("$".to_string());
			}
		} else {
			// Single segment: entire value used — signal to skip narrowing
			groups.entry(path.clone()).or_default().insert(String::new());
		}
	}

	groups
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn text_slots() {
		let tmpl = "<h1><!--seam:user.name--></h1><p><!--seam:user.email--></p>";
		let paths = collect_slot_paths(tmpl);
		assert_eq!(paths, BTreeSet::from(["user.name".into(), "user.email".into()]));
	}

	#[test]
	fn attr_slot() {
		let tmpl = r#"<!--seam:user.avatar:attr:src--><img>"#;
		let paths = collect_slot_paths(tmpl);
		assert_eq!(paths, BTreeSet::from(["user.avatar".into()]));
	}

	#[test]
	fn style_slot() {
		let tmpl = r#"<!--seam:spacing.top:style:margin-top--><div></div>"#;
		let paths = collect_slot_paths(tmpl);
		assert_eq!(paths, BTreeSet::from(["spacing.top".into()]));
	}

	#[test]
	fn html_slot() {
		let tmpl = "<!--seam:post.body:html-->";
		let paths = collect_slot_paths(tmpl);
		assert_eq!(paths, BTreeSet::from(["post.body".into()]));
	}

	#[test]
	fn if_each_match_directives() {
		let tmpl = concat!(
			"<!--seam:if:user.premium-->premium<!--seam:endif:user.premium-->",
			"<!--seam:each:posts-->item<!--seam:endeach-->",
			"<!--seam:match:status--><!--seam:when:active-->active<!--seam:endmatch-->",
		);
		let paths = collect_slot_paths(tmpl);
		assert!(paths.contains("user.premium"));
		assert!(paths.contains("posts"));
		assert!(paths.contains("status"));
		// Structural markers excluded
		assert!(!paths.contains("endeach"));
		assert!(!paths.contains("endmatch"));
	}

	#[test]
	fn nested_dollar_paths() {
		let tmpl = concat!(
			"<!--seam:each:repos-->",
			"<h2><!--seam:repos.$.title--></h2>",
			"<span><!--seam:repos.$.stars--></span>",
			"<!--seam:endeach-->",
		);
		let paths = collect_slot_paths(tmpl);
		assert!(paths.contains("repos"));
		assert!(paths.contains("repos.$.title"));
		assert!(paths.contains("repos.$.stars"));
	}

	#[test]
	fn group_by_loader_splitting() {
		let paths = BTreeSet::from(["user.name".into(), "user.email".into(), "repos.$.title".into()]);
		let grouped = group_by_loader(&paths);

		let user = grouped.get("user").unwrap();
		assert!(user.contains("name"));
		assert!(user.contains("email"));

		let repos = grouped.get("repos").unwrap();
		assert!(repos.contains("$"));
		assert!(repos.contains("$.title"));
	}

	#[test]
	fn single_segment_entire_value() {
		let paths = BTreeSet::from(["user".into()]);
		let grouped = group_by_loader(&paths);
		let user = grouped.get("user").unwrap();
		assert!(user.contains(""), "empty string signals entire value");
	}

	#[test]
	fn empty_template() {
		let paths = collect_slot_paths("<div>Hello World</div>");
		assert!(paths.is_empty());
	}

	#[test]
	fn excludes_structural_markers() {
		let tmpl = concat!(
			"<!--seam:outlet-->",
			"<!--seam:else-->",
			"<!--seam:page-styles-->",
			"<!--seam:page-scripts-->",
			"<!--seam:prefetch-->",
		);
		let paths = collect_slot_paths(tmpl);
		assert!(paths.is_empty());
	}
}
