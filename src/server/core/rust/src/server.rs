/* src/server/core/rust/src/server.rs */

use std::collections::BTreeMap;
use std::time::Duration;

use crate::build_loader::RpcHashMap;
use crate::channel::{ChannelDef, ChannelMeta};
use crate::context::{ContextConfig, ContextFieldDef};
use crate::page::{I18nConfig, PageDef};
use crate::procedure::{ProcedureDef, StreamDef, SubscriptionDef, UploadDef};
use crate::resolve::ResolveStrategy;
use crate::validation::ValidationMode;

/// Transport reliability configuration shared across all backends.
pub struct TransportConfig {
	pub heartbeat_interval: Duration,
	pub sse_idle_timeout: Duration,
	pub pong_timeout: Duration,
}

impl Default for TransportConfig {
	fn default() -> Self {
		Self {
			heartbeat_interval: Duration::from_secs(8),
			sse_idle_timeout: Duration::from_secs(12),
			pong_timeout: Duration::from_secs(5),
		}
	}
}

/// Framework-agnostic parts extracted from `SeamServer`.
/// Adapter crates consume this to build framework-specific routers.
pub struct SeamParts {
	pub procedures: Vec<ProcedureDef>,
	pub subscriptions: Vec<SubscriptionDef>,
	pub streams: Vec<StreamDef>,
	pub uploads: Vec<UploadDef>,
	pub pages: Vec<PageDef>,
	pub rpc_hash_map: Option<RpcHashMap>,
	pub i18n_config: Option<I18nConfig>,
	pub strategies: Vec<Box<dyn ResolveStrategy>>,
	pub channel_metas: BTreeMap<String, ChannelMeta>,
	pub context_config: ContextConfig,
	pub validation_mode: ValidationMode,
	pub transport_config: TransportConfig,
}

impl SeamParts {
	pub fn has_url_prefix(&self) -> bool {
		self.strategies.iter().any(|s| s.kind() == "url_prefix")
	}
}

pub struct SeamServer {
	procedures: Vec<ProcedureDef>,
	subscriptions: Vec<SubscriptionDef>,
	streams: Vec<StreamDef>,
	uploads: Vec<UploadDef>,
	channels: Vec<ChannelDef>,
	pages: Vec<PageDef>,
	rpc_hash_map: Option<RpcHashMap>,
	i18n_config: Option<I18nConfig>,
	strategies: Vec<Box<dyn ResolveStrategy>>,
	context_config: ContextConfig,
	validation_mode: ValidationMode,
	transport_config: TransportConfig,
}

impl SeamServer {
	pub fn new() -> Self {
		Self {
			procedures: Vec::new(),
			subscriptions: Vec::new(),
			streams: Vec::new(),
			uploads: Vec::new(),
			channels: Vec::new(),
			pages: Vec::new(),
			rpc_hash_map: None,
			i18n_config: None,
			strategies: Vec::new(),
			context_config: ContextConfig::new(),
			validation_mode: ValidationMode::Dev,
			transport_config: TransportConfig::default(),
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

	pub fn stream(mut self, stream: StreamDef) -> Self {
		self.streams.push(stream);
		self
	}

	pub fn upload(mut self, upload: UploadDef) -> Self {
		self.uploads.push(upload);
		self
	}

	pub fn channel(mut self, channel: ChannelDef) -> Self {
		self.channels.push(channel);
		self
	}

	/// Register procedures under a dot-separated namespace prefix (e.g. "blog" -> "blog.getPost").
	pub fn namespace(mut self, prefix: &str, procedures: Vec<ProcedureDef>) -> Self {
		for mut p in procedures {
			p.name = format!("{prefix}.{}", p.name);
			self.procedures.push(p);
		}
		self
	}

	/// Register subscriptions under a dot-separated namespace prefix.
	pub fn namespace_subs(mut self, prefix: &str, subs: Vec<SubscriptionDef>) -> Self {
		for mut s in subs {
			s.name = format!("{prefix}.{}", s.name);
			self.subscriptions.push(s);
		}
		self
	}

	/// Register streams under a dot-separated namespace prefix.
	pub fn namespace_streams(mut self, prefix: &str, streams: Vec<StreamDef>) -> Self {
		for mut s in streams {
			s.name = format!("{prefix}.{}", s.name);
			self.streams.push(s);
		}
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

	pub fn context(mut self, key: &str, field: ContextFieldDef) -> Self {
		self.context_config.insert(key.to_string(), field);
		self
	}

	pub fn validation_mode(mut self, mode: ValidationMode) -> Self {
		self.validation_mode = mode;
		self
	}

	pub fn transport_config(mut self, config: TransportConfig) -> Self {
		self.transport_config = config;
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
			streams: self.streams,
			uploads: self.uploads,
			pages: self.pages,
			rpc_hash_map: self.rpc_hash_map,
			i18n_config: self.i18n_config,
			strategies: self.strategies,
			channel_metas,
			context_config: self.context_config,
			validation_mode: self.validation_mode,
			transport_config: self.transport_config,
		}
	}
}

impl Default for SeamServer {
	fn default() -> Self {
		Self::new()
	}
}

#[cfg(test)]
mod tests {
	use super::TransportConfig;
	use std::time::Duration;

	#[test]
	fn transport_config_uses_8_second_heartbeat_and_12_second_idle_timeout_by_default() {
		let config = TransportConfig::default();
		assert_eq!(config.heartbeat_interval, Duration::from_secs(8));
		assert_eq!(config.sse_idle_timeout, Duration::from_secs(12));
	}
}
