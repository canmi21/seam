/* packages/server/injector/rust/src/ast.rs */

#[derive(Debug)]
pub(crate) enum AstNode {
  Text(String),
  Slot { path: String, mode: SlotMode },
  Attr { path: String, attr_name: String },
  StyleProp { path: String, css_property: String },
  If { path: String, then_nodes: Vec<AstNode>, else_nodes: Vec<AstNode> },
  Each { path: String, body_nodes: Vec<AstNode> },
  Match { path: String, branches: Vec<(String, Vec<AstNode>)> },
}

#[derive(Debug)]
pub(crate) enum SlotMode {
  Text,
  Html,
}
