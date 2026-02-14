use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use crate::errors::SeamError;

pub type BoxFuture<T> = Pin<Box<dyn Future<Output = T> + Send>>;

pub type HandlerFn =
  Arc<dyn Fn(serde_json::Value) -> BoxFuture<Result<serde_json::Value, SeamError>> + Send + Sync>;

pub struct ProcedureDef {
  pub name: String,
  pub input_schema: serde_json::Value,
  pub output_schema: serde_json::Value,
  pub handler: HandlerFn,
}
