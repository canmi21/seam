/* packages/server/core/rust/src/server.rs */

use crate::build_loader::RpcHashMap;
use crate::page::{I18nConfig, PageDef};
use crate::procedure::{ProcedureDef, SubscriptionDef};

/// Framework-agnostic parts extracted from `SeamServer`.
/// Adapter crates consume this to build framework-specific routers.
pub struct SeamParts {
  pub procedures: Vec<ProcedureDef>,
  pub subscriptions: Vec<SubscriptionDef>,
  pub pages: Vec<PageDef>,
  pub rpc_hash_map: Option<RpcHashMap>,
  pub i18n_config: Option<I18nConfig>,
}

pub struct SeamServer {
  procedures: Vec<ProcedureDef>,
  subscriptions: Vec<SubscriptionDef>,
  pages: Vec<PageDef>,
  rpc_hash_map: Option<RpcHashMap>,
  i18n_config: Option<I18nConfig>,
}

impl SeamServer {
  pub fn new() -> Self {
    Self {
      procedures: Vec::new(),
      subscriptions: Vec::new(),
      pages: Vec::new(),
      rpc_hash_map: None,
      i18n_config: None,
    }
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

  pub fn rpc_hash_map(mut self, map: RpcHashMap) -> Self {
    self.rpc_hash_map = Some(map);
    self
  }

  pub fn i18n_config(mut self, config: I18nConfig) -> Self {
    self.i18n_config = Some(config);
    self
  }

  /// Consume the builder, returning framework-agnostic parts for an adapter.
  pub fn into_parts(self) -> SeamParts {
    SeamParts {
      procedures: self.procedures,
      subscriptions: self.subscriptions,
      pages: self.pages,
      rpc_hash_map: self.rpc_hash_map,
      i18n_config: self.i18n_config,
    }
  }
}

impl Default for SeamServer {
  fn default() -> Self {
    Self::new()
  }
}
