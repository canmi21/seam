/* packages/server/core/rust/src/injector/ast.rs */

#[derive(Debug)]
pub(super) enum AstNode {
  Text(String),
  Slot { path: String, mode: SlotMode },
  Attr { path: String, attr_name: String },
  If { path: String, then_nodes: Vec<AstNode>, else_nodes: Vec<AstNode> },
  Each { path: String, body_nodes: Vec<AstNode> },
  Match { path: String, branches: Vec<(String, Vec<AstNode>)> },
}

#[derive(Debug)]
pub(super) enum SlotMode {
  Text,
  Html,
}
