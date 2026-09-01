/* src/server/core/rust/src/procedure.rs */

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use futures_core::Stream;
use futures_util::StreamExt;
use serde::Serialize;

use crate::errors::SeamError;

pub type BoxFuture<T> = Pin<Box<dyn Future<Output = T> + Send>>;

pub type BoxStream<T> = Pin<Box<dyn Stream<Item = T> + Send>>;

pub fn map_stream_output<T>(
	stream: BoxStream<Result<T, SeamError>>,
) -> BoxStream<Result<serde_json::Value, SeamError>>
where
	T: Serialize + Send + 'static,
{
	Box::pin(stream.map(|item| {
		item
			.and_then(|value| serde_json::to_value(value).map_err(|e| SeamError::internal(e.to_string())))
	}))
}

pub type HandlerFn = Arc<
	dyn Fn(serde_json::Value, serde_json::Value) -> BoxFuture<Result<serde_json::Value, SeamError>>
		+ Send
		+ Sync,
>;

pub struct SubscriptionParams {
	pub input: serde_json::Value,
	pub ctx: serde_json::Value,
	pub last_event_id: Option<String>,
}

pub type SubscriptionHandlerFn = Arc<
	dyn Fn(
			SubscriptionParams,
		) -> BoxFuture<Result<BoxStream<Result<serde_json::Value, SeamError>>, SeamError>>
		+ Send
		+ Sync,
>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProcedureType {
	Query,
	Command,
}

pub struct ProcedureDef {
	pub name: String,
	pub proc_type: ProcedureType,
	pub input_schema: serde_json::Value,
	pub output_schema: serde_json::Value,
	pub error_schema: Option<serde_json::Value>,
	pub context_keys: Vec<String>,
	pub suppress: Option<Vec<String>>,
	pub cache: Option<serde_json::Value>,
	pub handler: HandlerFn,
}

pub struct SubscriptionDef {
	pub name: String,
	pub input_schema: serde_json::Value,
	pub output_schema: serde_json::Value,
	pub error_schema: Option<serde_json::Value>,
	pub context_keys: Vec<String>,
	pub suppress: Option<Vec<String>>,
	pub handler: SubscriptionHandlerFn,
}

pub struct StreamParams {
	pub input: serde_json::Value,
	pub ctx: serde_json::Value,
}

pub type StreamHandlerFn = Arc<
	dyn Fn(
			StreamParams,
		) -> BoxFuture<Result<BoxStream<Result<serde_json::Value, SeamError>>, SeamError>>
		+ Send
		+ Sync,
>;

pub type UploadHandlerFn = Arc<
	dyn Fn(
			serde_json::Value,
			SeamFileHandle,
			serde_json::Value,
		) -> BoxFuture<Result<serde_json::Value, SeamError>>
		+ Send
		+ Sync,
>;

/// File received from a multipart upload request.
pub struct SeamFileHandle {
	pub name: Option<String>,
	pub content_type: Option<String>,
	pub data: bytes::Bytes,
}

pub struct StreamDef {
	pub name: String,
	pub input_schema: serde_json::Value,
	pub chunk_output_schema: serde_json::Value,
	pub error_schema: Option<serde_json::Value>,
	pub context_keys: Vec<String>,
	pub suppress: Option<Vec<String>>,
	pub handler: StreamHandlerFn,
}

pub struct UploadDef {
	pub name: String,
	pub input_schema: serde_json::Value,
	pub output_schema: serde_json::Value,
	pub error_schema: Option<serde_json::Value>,
	pub context_keys: Vec<String>,
	pub suppress: Option<Vec<String>>,
	pub handler: UploadHandlerFn,
}
