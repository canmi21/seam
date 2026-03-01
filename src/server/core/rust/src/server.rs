/* src/server/core/rust/src/server.rs */

use std::collections::BTreeMap;

use crate::build_loader::RpcHashMap;
use crate::channel::{ChannelDef, ChannelMeta};
use crate::page::{I18nConfig, PageDef};
use crate::procedure::{ProcedureDef, SubscriptionDef};
use crate::resolve::ResolveStrategy;

/// Framework-agnostic parts extracted from `SeamServer`.
/// Adapter crates consume this to build framework-specific routers.
pub struct SeamParts {
  pub procedures: Vec<ProcedureDef>,
  pub subscriptions: Vec<SubscriptionDef>,
  pub pages: Vec<PageDef>,
  pub rpc_hash_map: Option<RpcHashMap>,
  pub i18n_config: Option<I18nConfig>,
  pub strategies: Vec<Box<dyn ResolveStrategy>>,
  pub channel_metas: BTreeMap<String, ChannelMeta>,
}

impl SeamParts {
  pub fn has_url_prefix(&self) -> bool {
    self.strategies.iter().any(|s| s.kind() == "url_prefix")
  }
}

pub struct SeamServer {
  procedures: Vec<ProcedureDef>,
  subscriptions: Vec<SubscriptionDef>,
  channels: Vec<ChannelDef>,
  pages: Vec<PageDef>,
  rpc_hash_map: Option<RpcHashMap>,
  i18n_config: Option<I18nConfig>,
  strategies: Vec<Box<dyn ResolveStrategy>>,
}

impl SeamServer {
  pub fn new() -> Self {
    Self {
      procedures: Vec::new(),
      subscriptions: Vec::new(),
      channels: Vec::new(),
      pages: Vec::new(),
      rpc_hash_map: None,
      i18n_config: None,
      strategies: Vec::new(),
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

  pub fn channel(mut self, channel: ChannelDef) -> Self {
    self.channels.push(channel);
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

  pub fn resolve_strategies(mut self, strategies: Vec<Box<dyn ResolveStrategy>>) -> Self {
    self.strategies = strategies;
    self
  }

  /// Consume the builder, returning framework-agnostic parts for an adapter.
  /// Channels are expanded into their Level 0 primitives (commands + subscriptions).
  pub fn into_parts(self) -> SeamParts {
    let mut procedures = self.procedures;
    let mut subscriptions = self.subscriptions;
    let mut channel_metas = BTreeMap::new();

    for channel in self.channels {
      let name = channel.name.clone();
      let (procs, subs, meta) = channel.expand();
      procedures.extend(procs);
      subscriptions.extend(subs);
      channel_metas.insert(name, meta);
    }

    SeamParts {
      procedures,
      subscriptions,
      pages: self.pages,
      rpc_hash_map: self.rpc_hash_map,
      i18n_config: self.i18n_config,
      strategies: self.strategies,
      channel_metas,
    }
  }
}

impl Default for SeamServer {
  fn default() -> Self {
    Self::new()
  }
}
