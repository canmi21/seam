/* src/cli/skeleton/src/ctr_check/mod.rs */

// CTR equivalence check: verify that template injection produces
// semantically equivalent HTML to React's renderToString.
//
// Pipeline: parse → normalize → diff → report
// Eliminates false positives from attribute ordering, CSS property
// ordering, comment markers, and resource hint injection.

mod diff;
mod normalize;
mod parse;
mod report;

use anyhow::{Result, bail};
use serde_json::Value;

/// Verify that template injection with mock data produces semantically
/// equivalent HTML to React's renderToString with the same data.
pub fn verify_ctr_equivalence(
	route_path: &str,
	react_html: &str,
	template: &str,
	mock_data: &Value,
	data_id: &str,
) -> Result<()> {
	let injected_raw = seam_injector::inject(template, mock_data, data_id);

	let mut react_tree = parse::parse_ctr_tree(react_html, data_id);
	let mut inject_tree = parse::parse_ctr_tree(&injected_raw, data_id);

	normalize::normalize_tree(&mut react_tree);
	normalize::normalize_tree(&mut inject_tree);

	let result = diff::diff_trees(&react_tree, &inject_tree, "");
	if result.diffs.is_empty() {
		return Ok(());
	}

	bail!("{}", report::format_ctr_report(route_path, &result.diffs, result.total_count));
}

#[cfg(test)]
mod tests;
