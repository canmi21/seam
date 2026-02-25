/* packages/server/core/rust/src/server.rs */

use crate::page::PageDef;
use crate::procedure::{ProcedureDef, SubscriptionDef};

/// Framework-agnostic parts extracted from `SeamServer`.
/// Adapter crates consume this to build framework-specific routers.
pub struct SeamParts {
  pub procedures: Vec<ProcedureDef>,
  pub subscriptions: Vec<SubscriptionDef>,
  pub pages: Vec<PageDef>,
}

pub struct SeamServer {
  procedures: Vec<ProcedureDef>,
  subscriptions: Vec<SubscriptionDef>,
  pages: Vec<PageDef>,
}

impl SeamServer {
  pub fn new() -> Self {
    Self { procedures: Vec::new(), subscriptions: Vec::new(), pages: Vec::new() }
  }

  pub fn procedure(mut self, proc: ProcedureDef) -> Self {
    self.procedures.push(proc);
    self
  }

  pub fn subscription(mut self, sub: SubscriptionDef) -> Self {
    self.subscriptions.push(sub);
    self
  }

  pub fn page(mut self, page: PageDef) -> Self {
    self.pages.push(page);
    self
  }

  /// Consume the builder, returning framework-agnostic parts for an adapter.
  pub fn into_parts(self) -> SeamParts {
    SeamParts { procedures: self.procedures, subscriptions: self.subscriptions, pages: self.pages }
  }
}

impl Default for SeamServer {
  fn default() -> Self {
    Self::new()
  }
}
