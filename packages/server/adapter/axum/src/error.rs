/* packages/server/adapter/axum/src/error.rs */

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use seam_server::SeamError;

/// Newtype wrapper to implement `IntoResponse` for `SeamError`.
/// Required because Rust's orphan rule prevents `impl IntoResponse for SeamError`
/// when both types are foreign to this crate.
pub(crate) struct AxumError(pub SeamError);

impl IntoResponse for AxumError {
  fn into_response(self) -> Response {
    let err = self.0;
    let status = StatusCode::from_u16(err.status()).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
    let body = serde_json::json!({
      "ok": false,
      "error": {
        "code": err.code(),
        "message": err.message(),
        "transient": false,
      }
    });
    (status, axum::Json(body)).into_response()
  }
}

impl From<SeamError> for AxumError {
  fn from(err: SeamError) -> Self {
    Self(err)
  }
}
