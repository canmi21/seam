/* packages/server/core/rust/src/procedure.rs */

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use futures_core::Stream;

use crate::errors::SeamError;

pub type BoxFuture<T> = Pin<Box<dyn Future<Output = T> + Send>>;

pub type BoxStream<T> = Pin<Box<dyn Stream<Item = T> + Send>>;

pub type HandlerFn =
  Arc<dyn Fn(serde_json::Value) -> BoxFuture<Result<serde_json::Value, SeamError>> + Send + Sync>;

pub type SubscriptionHandlerFn = Arc<
  dyn Fn(
      serde_json::Value,
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
  pub handler: HandlerFn,
}

pub struct SubscriptionDef {
  pub name: String,
  pub input_schema: serde_json::Value,
  pub output_schema: serde_json::Value,
  pub error_schema: Option<serde_json::Value>,
  pub handler: SubscriptionHandlerFn,
}
