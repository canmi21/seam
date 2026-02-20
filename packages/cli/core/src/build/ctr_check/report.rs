/* packages/cli/core/src/build/ctr_check/report.rs */

// Format CTR diff results into developer-friendly error messages.
// Labels use "react" vs "template" (not expected/actual) for clarity.

use super::diff::CtrDiff;

/// Format a CTR equivalence check failure report.
pub(super) fn format_ctr_report(route_path: &str, diffs: &[CtrDiff], total_count: usize) -> String {
  let mut out = String::new();
  out.push_str("[seam] error: CTR equivalence check failed\n\n");
  out.push_str(&format!("  Route: {}\n", route_path));

  for (i, diff) in diffs.iter().enumerate() {
    out.push('\n');
    format_diff(&mut out, i + 1, diff);
  }

  if total_count > diffs.len() {
    out.push_str(&format!("\n  ... and {} more differences\n", total_count - diffs.len()));
  }

  out.push_str(
    "\n  The template output differs from what React produces with the same data.\
     \n  This means the component transforms data before rendering -- the sentinel\
     \n  placeholder was consumed by a runtime computation (e.g. map lookup,\
     \n  string formatting) and the result got hardcoded into the template.\
     \n\
     \n  CTR requires pure data flow: procedure -> data -> template -> HTML.\
     \n  Move the computation into your procedure handler and return the\
     \n  computed value as a dedicated field.",
  );

  out
}

fn format_diff(out: &mut String, index: usize, diff: &CtrDiff) {
  match diff {
    CtrDiff::TagMismatch { path, expected, actual } => {
      out.push_str(&format!("  {}. {}\n", index, path));
      out.push_str("     Tag mismatch\n");
      out.push_str(&format!("       react:    <{}>\n", expected));
      out.push_str(&format!("       template: <{}>\n", actual));
    }
    CtrDiff::AttrMissing { path, attr, expected_value } => {
      out.push_str(&format!("  {}. {}\n", index, path));
      out.push_str(&format!("     Missing attribute: {}\n", attr));
      out.push_str(&format!("       react: \"{}\"\n", expected_value));
    }
    CtrDiff::AttrExtra { path, attr, actual_value } => {
      out.push_str(&format!("  {}. {}\n", index, path));
      out.push_str(&format!("     Extra attribute: {}\n", attr));
      out.push_str(&format!("       template: \"{}\"\n", actual_value));
    }
    CtrDiff::AttrValueMismatch { path, attr, expected, actual } => {
      out.push_str(&format!("  {}. {}\n", index, path));
      out.push_str(&format!("     Attribute value mismatch: {}\n", attr));
      out.push_str(&format!("       react:    {}\n", expected));
      out.push_str(&format!("       template: {}\n", actual));
    }
    CtrDiff::TextMismatch { path, expected, actual } => {
      out.push_str(&format!("  {}. {}\n", index, path));
      out.push_str("     Text content mismatch\n");
      out.push_str(&format!("       react:    \"{}\"\n", expected));
      out.push_str(&format!("       template: \"{}\"\n", actual));
    }
    CtrDiff::TypeMismatch { path, expected_kind, actual_kind } => {
      out.push_str(&format!("  {}. {}\n", index, path));
      out.push_str(&format!(
        "     Node type mismatch: expected {}, got {}\n",
        expected_kind, actual_kind
      ));
    }
    CtrDiff::NodeMissing { path, expected_tag } => {
      out.push_str(&format!("  {}. {}\n", index, if path.is_empty() { "[root]" } else { path }));
      out.push_str(&format!("     Missing node: <{}>\n", expected_tag));
    }
    CtrDiff::NodeExtra { path, actual_tag } => {
      out.push_str(&format!("  {}. {}\n", index, if path.is_empty() { "[root]" } else { path }));
      out.push_str(&format!("     Extra node: <{}>\n", actual_tag));
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn report_single_diff() {
    let diffs = vec![CtrDiff::AttrValueMismatch {
      path: "div.grid > span".to_string(),
      attr: "style".to_string(),
      expected: "background-color:#f1e05a;display:inline-block".to_string(),
      actual: "display:inline-block;background-color:#f1e05a".to_string(),
    }];
    let report = format_ctr_report("/dashboard", &diffs, 1);
    assert!(report.contains("CTR equivalence check failed"));
    assert!(report.contains("/dashboard"));
    assert!(report.contains("div.grid > span"));
    assert!(report.contains("style"));
    assert!(!report.contains("more differences"));
  }

  #[test]
  fn report_truncation_message() {
    let diffs: Vec<CtrDiff> = (0..5)
      .map(|i| CtrDiff::TextMismatch {
        path: format!("p:nth-child({})", i + 1),
        expected: format!("a{}", i),
        actual: format!("b{}", i),
      })
      .collect();
    let report = format_ctr_report("/page", &diffs, 8);
    assert!(report.contains("and 3 more differences"));
  }
}
