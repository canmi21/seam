/* src/server/adapter/axum/src/handler/mod.rs */

mod channel;
mod page;
mod projection;
mod rpc;
mod sse_lifecycle;
mod stream;
mod subscribe;
mod upload;

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use axum::routing::{get, post};
use seam_server::RpcHashMap;
use seam_server::SeamError;
use seam_server::context::{ContextConfig, RawContextMap, resolve_context};
use seam_server::page::PageDef;
use seam_server::procedure::{ProcedureDef, ProcedureType, StreamDef, SubscriptionDef, UploadDef};
use seam_server::resolve::ResolveStrategy;

pub(crate) struct AppState {
	pub manifest_json: serde_json::Value,
	pub handlers: HashMap<String, Arc<ProcedureDef>>,
	pub subscriptions: HashMap<String, Arc<SubscriptionDef>>,
	pub streams: HashMap<String, Arc<StreamDef>>,
	pub uploads: HashMap<String, Arc<UploadDef>>,
	pub pages: HashMap<String, Arc<PageDef>>,
	pub rpc_hash_map: Option<HashMap<String, String>>,
	pub batch_hash: Option<String>,
	pub i18n_config: Option<seam_server::I18nConfig>,
	pub locale_set: Option<std::collections::HashSet<String>>,
	pub strategies: Vec<Box<dyn ResolveStrategy>>,
	pub context_config: ContextConfig,
	pub should_validate: bool,
	pub compiled_input_schemas: HashMap<String, seam_server::CompiledSchema>,
	pub compiled_sub_input_schemas: HashMap<String, seam_server::CompiledSchema>,
	pub compiled_stream_input_schemas: HashMap<String, seam_server::CompiledSchema>,
	pub compiled_upload_input_schemas: HashMap<String, seam_server::CompiledSchema>,
	/// Maps procedure name -> kind ("query"|"command"|"stream"|"upload")
	pub kind_map: HashMap<String, &'static str>,
	pub heartbeat_interval: Duration,
	pub sse_idle_timeout: Duration,
	pub pong_timeout: Duration,
}

/// Extract raw context values from HTTP request (headers, cookies, query).
pub(super) fn extract_raw_context_from_req(
	config: &ContextConfig,
	headers: &axum::http::HeaderMap,
	uri: &axum::http::Uri,
) -> RawContextMap {
	let header_list: Vec<(String, String)> = headers
		.iter()
		.filter_map(|(k, v)| v.to_str().ok().map(|v| (k.as_str().to_string(), v.to_string())))
		.collect();
	let cookie_header = headers.get("cookie").and_then(|v| v.to_str().ok());
	let query_string = uri.query();
	seam_server::extract_raw_context(config, &header_list, cookie_header, query_string)
}

/// Resolve context for a specific procedure given its context_keys.
pub(super) fn resolve_ctx_for_proc(
	state: &AppState,
	context_keys: &[String],
	headers: &axum::http::HeaderMap,
	uri: &axum::http::Uri,
) -> Result<serde_json::Value, SeamError> {
	if context_keys.is_empty() {
		return Ok(serde_json::Value::Object(serde_json::Map::new()));
	}
	let raw = extract_raw_context_from_req(&state.context_config, headers, uri);
	resolve_context(&state.context_config, &raw, context_keys)
}

#[allow(clippy::too_many_arguments, clippy::too_many_lines)]
pub(crate) fn build_router(
	manifest_json: serde_json::Value,
	mut handlers: HashMap<String, Arc<ProcedureDef>>,
	subscriptions: HashMap<String, Arc<SubscriptionDef>>,
	streams: HashMap<String, Arc<StreamDef>>,
	uploads: HashMap<String, Arc<UploadDef>>,
	pages: Vec<PageDef>,
	hash_map: Option<RpcHashMap>,
	i18n_config: Option<seam_server::I18nConfig>,
	strategies: Vec<Box<dyn ResolveStrategy>>,
	context_config: ContextConfig,
	validation_mode: &seam_server::ValidationMode,
	transport_config: &seam_server::TransportConfig,
) -> Router {
	let (rpc_hash_map, batch_hash) = match hash_map {
		Some(m) => {
			let mut rev = m.reverse_lookup();
			// Built-in procedures bypass hash obfuscation (identity mapping)
			rev.insert("__seam_i18n_query".to_string(), "__seam_i18n_query".to_string());
			(Some(rev), Some(m.batch))
		}
		None => (None, None),
	};

	let locale_set = i18n_config
		.as_ref()
		.map(|c| c.locales.iter().cloned().collect::<std::collections::HashSet<_>>());

	// Use default strategies when none provided
	let strategies =
		if strategies.is_empty() { seam_server::default_strategies() } else { strategies };

	let has_url_prefix = strategies.iter().any(|s| s.kind() == "url_prefix");

	// Register built-in __seam_i18n_query procedure (route-hash-based lookup)
	if let Some(ref i18n) = i18n_config {
		let i18n_clone = i18n.clone();
		handlers.insert(
			"__seam_i18n_query".to_string(),
			Arc::new(ProcedureDef {
				name: "__seam_i18n_query".to_string(),
				proc_type: ProcedureType::Query,
				input_schema: serde_json::json!({}),
				output_schema: serde_json::json!({}),
				error_schema: None,
				context_keys: vec![],
				suppress: None,
				cache: None,
				handler: Arc::new(move |input: serde_json::Value, _ctx: serde_json::Value| {
					let i18n = i18n_clone.clone();
					Box::pin(async move {
						let route_hash = input.get("route").and_then(|v| v.as_str()).unwrap_or("").to_string();
						let locale =
							input.get("locale").and_then(|v| v.as_str()).unwrap_or(&i18n.default).to_string();

						let messages = lookup_i18n_messages(&i18n, &route_hash, &locale);
						let hash = i18n
							.content_hashes
							.get(&route_hash)
							.and_then(|m| m.get(&locale))
							.cloned()
							.unwrap_or_default();

						Ok(serde_json::json!({ "hash": hash, "messages": messages }))
					})
				}),
			}),
		);
	}

	let should_validate = seam_server::should_validate(validation_mode);

	let mut compiled_input_schemas = HashMap::new();
	if should_validate {
		for (name, proc) in &handlers {
			if let Ok(cs) = seam_server::compile_schema(&proc.input_schema) {
				compiled_input_schemas.insert(name.clone(), cs);
			}
		}
	}

	let mut compiled_sub_input_schemas = HashMap::new();
	if should_validate {
		for (name, sub) in &subscriptions {
			if let Ok(cs) = seam_server::compile_schema(&sub.input_schema) {
				compiled_sub_input_schemas.insert(name.clone(), cs);
			}
		}
	}

	let mut compiled_stream_input_schemas = HashMap::new();
	if should_validate {
		for (name, stream) in &streams {
			if let Ok(cs) = seam_server::compile_schema(&stream.input_schema) {
				compiled_stream_input_schemas.insert(name.clone(), cs);
			}
		}
	}

	let mut compiled_upload_input_schemas = HashMap::new();
	if should_validate {
		for (name, upload) in &uploads {
			if let Ok(cs) = seam_server::compile_schema(&upload.input_schema) {
				compiled_upload_input_schemas.insert(name.clone(), cs);
			}
		}
	}

	// Build kind map for unified POST dispatcher
	let mut kind_map = HashMap::new();
	for (name, proc) in &handlers {
		match proc.proc_type {
			ProcedureType::Command => kind_map.insert(name.clone(), "command"),
			ProcedureType::Query => kind_map.insert(name.clone(), "query"),
		};
	}
	for name in streams.keys() {
		kind_map.insert(name.clone(), "stream");
	}
	for name in uploads.keys() {
		kind_map.insert(name.clone(), "upload");
	}

	let mut page_map = HashMap::new();
	let mut router = Router::new().route("/_seam/manifest.json", get(rpc::handle_manifest)).route(
		"/_seam/procedure/{name}",
		post(rpc::handle_procedure_post).get(subscribe::handle_subscribe),
	);

	// Pages are served under /_seam/page/* prefix only.
	for page in pages {
		let full_route = format!("/_seam/page{}", page.route);
		let page_arc = Arc::new(page);
		page_map.insert(full_route.clone(), page_arc.clone());
		router = router.route(&full_route, get(page::handle_page));

		// Register locale-prefixed routes only when url_prefix strategy is active
		if has_url_prefix {
			let locale_route = format!("/_seam/page/{{_seam_locale}}{}", page_arc.route);
			page_map.insert(locale_route.clone(), page_arc.clone());
			router = router.route(&locale_route, get(page::handle_page));
		}
	}

	let state = Arc::new(AppState {
		manifest_json,
		handlers,
		subscriptions,
		streams,
		uploads,
		pages: page_map,
		rpc_hash_map,
		batch_hash,
		i18n_config,
		locale_set,
		strategies,
		context_config,
		should_validate,
		compiled_input_schemas,
		compiled_sub_input_schemas,
		compiled_stream_input_schemas,
		compiled_upload_input_schemas,
		kind_map,
		heartbeat_interval: transport_config.heartbeat_interval,
		sse_idle_timeout: transport_config.sse_idle_timeout,
		pong_timeout: transport_config.pong_timeout,
	});

	router.with_state(state)
}

/// Look up pre-resolved messages by route hash + locale. Zero merge, zero filter.
pub(super) fn lookup_i18n_messages(
	i18n: &seam_server::I18nConfig,
	route_hash: &str,
	locale: &str,
) -> serde_json::Value {
	// Paged mode: read from disk
	if i18n.mode == "paged" {
		if let Some(ref dist_dir) = i18n.dist_dir {
			let path = dist_dir.join("i18n").join(route_hash).join(format!("{locale}.json"));
			if let Ok(content) = std::fs::read_to_string(&path)
				&& let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content)
			{
				return parsed;
			}
		}
		return serde_json::Value::Object(Default::default());
	}

	// Memory mode: direct lookup
	i18n
		.messages
		.get(locale)
		.and_then(|route_msgs| route_msgs.get(route_hash))
		.cloned()
		.unwrap_or(serde_json::Value::Object(Default::default()))
}
