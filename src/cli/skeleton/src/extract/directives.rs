/* src/cli/skeleton/src/extract/directives.rs */

// Comment directive constructors for seam template extraction.
// Reduces inline `DomNode::Comment(format!(...))` calls across boolean, array, enum_axis.

use super::dom::DomNode;

pub(super) fn comment_if(path: &str) -> DomNode {
	DomNode::Comment(format!("seam:if:{path}"))
}

pub(super) fn comment_else() -> DomNode {
	DomNode::Comment("seam:else".into())
}

pub(super) fn comment_endif(path: &str) -> DomNode {
	DomNode::Comment(format!("seam:endif:{path}"))
}

pub(super) fn comment_each(path: &str) -> DomNode {
	DomNode::Comment(format!("seam:each:{path}"))
}

pub(super) fn comment_endeach() -> DomNode {
	DomNode::Comment("seam:endeach".into())
}

pub(super) fn comment_match(path: &str) -> DomNode {
	DomNode::Comment(format!("seam:match:{path}"))
}

pub(super) fn comment_when(value: &str) -> DomNode {
	DomNode::Comment(format!("seam:when:{value}"))
}

pub(super) fn comment_endmatch() -> DomNode {
	DomNode::Comment("seam:endmatch".into())
}
