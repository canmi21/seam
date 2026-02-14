/* packages/server/core/rust/src/errors.rs */

use std::fmt;

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::json;

#[derive(Debug)]
pub enum SeamError {
  Validation(String),
  NotFound(String),
  Internal(String),
}

impl SeamError {
  pub fn validation(msg: impl Into<String>) -> Self {
    Self::Validation(msg.into())
  }

  pub fn not_found(msg: impl Into<String>) -> Self {
    Self::NotFound(msg.into())
  }

  pub fn internal(msg: impl Into<String>) -> Self {
    Self::Internal(msg.into())
  }

  fn code(&self) -> &str {
    match self {
      Self::Validation(_) => "VALIDATION_ERROR",
      Self::NotFound(_) => "NOT_FOUND",
      Self::Internal(_) => "INTERNAL_ERROR",
    }
  }

  fn message(&self) -> &str {
    match self {
      Self::Validation(m) | Self::NotFound(m) | Self::Internal(m) => m,
    }
  }

  fn status(&self) -> StatusCode {
    match self {
      Self::Validation(_) => StatusCode::BAD_REQUEST,
      Self::NotFound(_) => StatusCode::NOT_FOUND,
      Self::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
    }
  }
}

impl fmt::Display for SeamError {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    write!(f, "{}: {}", self.code(), self.message())
  }
}

impl std::error::Error for SeamError {}

impl IntoResponse for SeamError {
  fn into_response(self) -> Response {
    let body = json!({
      "error": {
        "code": self.code(),
        "message": self.message(),
      }
    });
    (self.status(), axum::Json(body)).into_response()
  }
}
