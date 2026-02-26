/* packages/server/core/rust/src/procedure.rs */

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use futures_core::Stream;

use crate::errors::SeamError;

pub type BoxFuture<T> = Pin<Box<dyn Future<Output = T> + Send>>;

pub type BoxStream<T> = Pin<Box<dyn Stream<Item = T> + Send>>;

/// Request context passed to procedure handlers.
#[derive(Clone, Default)]
pub struct ProcedureCtx {
  pub locale: Option<String>,
}

pub type HandlerFn = Arc<
  dyn Fn(serde_json::Value, ProcedureCtx) -> BoxFuture<Result<serde_json::Value, SeamError>>
    + Send
    + Sync,
>;

pub type SubscriptionHandlerFn = Arc<
  dyn Fn(
      serde_json::Value,
    ) -> BoxFuture<Result<BoxStream<Result<serde_json::Value, SeamError>>, SeamError>>
    + Send
    + Sync,
>;

pub struct ProcedureDef {
  pub name: String,
  pub input_schema: serde_json::Value,
  pub output_schema: serde_json::Value,
  pub handler: HandlerFn,
}

pub struct SubscriptionDef {
  pub name: String,
  pub input_schema: serde_json::Value,
  pub output_schema: serde_json::Value,
  pub handler: SubscriptionHandlerFn,
}
