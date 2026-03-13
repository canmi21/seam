/* src/cli/skeleton/src/template_invariant.rs */

use crate::Axis;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TemplateInvariantViolation {
	pub axis_path: String,
	pub message: String,
}

pub fn check_template_invariants(
	axes: &[Axis],
	variants: &[String],
	template: &str,
) -> Vec<TemplateInvariantViolation> {
	let mut violations = Vec::new();

	for axis in axes {
		if axis.kind != "array" {
			continue;
		}

		let slot_prefix = format!("seam:{}.$.", axis.path);
		let renders_item_slots = variants.iter().any(|variant| variant.contains(&slot_prefix));
		if !renders_item_slots {
			continue;
		}

		let each_directive = format!("<!--seam:each:{}-->", axis.path);
		if !template.contains(&each_directive) {
			violations.push(TemplateInvariantViolation {
				axis_path: axis.path.clone(),
				message: format!(
					"array axis \"{}\" rendered item slots, but the final template is missing {}",
					axis.path, each_directive
				),
			});
		}

		if template.contains(&slot_prefix) {
			violations.push(TemplateInvariantViolation {
				axis_path: axis.path.clone(),
				message: format!(
					"array axis \"{}\" leaked full item slot paths like \"{}\" instead of scoped $. slots",
					axis.path, slot_prefix
				),
			});
		}
	}

	violations
}

#[cfg(test)]
mod tests {
	use super::*;

	fn array_axis(path: &str) -> Axis {
		Axis { path: path.to_string(), kind: "array".to_string(), values: vec![] }
	}

	#[test]
	fn detects_missing_each_for_rendered_array_axis() {
		let axes = vec![array_axis("watches.items")];
		let variants = vec![r#"<div><!--seam:watches.items.$.brand--></div>"#.to_string()];
		let template = r#"<div><!--seam:watches.items.$.brand--></div>"#;

		let violations = check_template_invariants(&axes, &variants, template);

		assert_eq!(violations.len(), 2);
		assert!(violations[0].message.contains("missing <!--seam:each:watches.items-->"));
		assert!(violations[1].message.contains("leaked full item slot paths"));
	}

	#[test]
	fn detects_leaked_array_item_paths_even_when_each_exists() {
		let axes = vec![array_axis("watches.items")];
		let variants = vec![r#"<div><!--seam:watches.items.$.brand--></div>"#.to_string()];
		let template = r#"<!--seam:each:watches.items--><div><!--seam:watches.items.$.brand--></div><!--seam:endeach-->"#;

		let violations = check_template_invariants(&axes, &variants, template);

		assert_eq!(violations.len(), 1);
		assert!(violations[0].message.contains("leaked full item slot paths"));
	}

	#[test]
	fn ignores_array_axes_that_do_not_render_item_slots() {
		let axes = vec![array_axis("watches.items")];
		let variants = vec![r#"<div>No sold watches.</div>"#.to_string()];
		let template = r#"<div>No sold watches.</div>"#;

		let violations = check_template_invariants(&axes, &variants, template);

		assert!(violations.is_empty());
	}

	#[test]
	fn accepts_properly_scoped_array_template() {
		let axes = vec![array_axis("watches.items")];
		let variants = vec![r#"<div><!--seam:watches.items.$.brand--></div>"#.to_string()];
		let template =
			r#"<!--seam:each:watches.items--><div><!--seam:$.brand--></div><!--seam:endeach-->"#;

		let violations = check_template_invariants(&axes, &variants, template);

		assert!(violations.is_empty());
	}
}
