/* packages/server/core/rust/src/errors.rs */

use std::fmt;

#[derive(Debug)]
pub struct SeamError {
  code: String,
  message: String,
  status: u16,
}

fn default_status(code: &str) -> u16 {
  match code {
    "VALIDATION_ERROR" => 400,
    "UNAUTHORIZED" => 401,
    "FORBIDDEN" => 403,
    "NOT_FOUND" => 404,
    "RATE_LIMITED" => 429,
    "INTERNAL_ERROR" => 500,
    _ => 500,
  }
}

impl SeamError {
  pub fn new(code: impl Into<String>, message: impl Into<String>, status: u16) -> Self {
    Self { code: code.into(), message: message.into(), status }
  }

  pub fn with_code(code: impl Into<String>, message: impl Into<String>) -> Self {
    let code = code.into();
    let status = default_status(&code);
    Self { code, message: message.into(), status }
  }

  pub fn validation(msg: impl Into<String>) -> Self {
    Self::with_code("VALIDATION_ERROR", msg)
  }

  pub fn not_found(msg: impl Into<String>) -> Self {
    Self::with_code("NOT_FOUND", msg)
  }

  pub fn internal(msg: impl Into<String>) -> Self {
    Self::with_code("INTERNAL_ERROR", msg)
  }

  pub fn unauthorized(msg: impl Into<String>) -> Self {
    Self::with_code("UNAUTHORIZED", msg)
  }

  pub fn forbidden(msg: impl Into<String>) -> Self {
    Self::with_code("FORBIDDEN", msg)
  }

  pub fn rate_limited(msg: impl Into<String>) -> Self {
    Self::with_code("RATE_LIMITED", msg)
  }

  pub fn code(&self) -> &str {
    &self.code
  }

  pub fn message(&self) -> &str {
    &self.message
  }

  pub fn status(&self) -> u16 {
    self.status
  }
}

impl fmt::Display for SeamError {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    write!(f, "{}: {}", self.code, self.message)
  }
}

impl std::error::Error for SeamError {}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn default_status_known_codes() {
    assert_eq!(default_status("VALIDATION_ERROR"), 400);
    assert_eq!(default_status("UNAUTHORIZED"), 401);
    assert_eq!(default_status("FORBIDDEN"), 403);
    assert_eq!(default_status("NOT_FOUND"), 404);
    assert_eq!(default_status("RATE_LIMITED"), 429);
    assert_eq!(default_status("INTERNAL_ERROR"), 500);
  }

  #[test]
  fn default_status_unknown_code() {
    assert_eq!(default_status("CUSTOM_ERROR"), 500);
  }

  #[test]
  fn new_explicit_status() {
    let err = SeamError::new("RATE_LIMITED", "too fast", 429);
    assert_eq!(err.code(), "RATE_LIMITED");
    assert_eq!(err.message(), "too fast");
    assert_eq!(err.status(), 429);
  }

  #[test]
  fn with_code_auto_resolves_status() {
    let err = SeamError::with_code("NOT_FOUND", "gone");
    assert_eq!(err.status(), 404);
  }

  #[test]
  fn convenience_constructors() {
    assert_eq!(SeamError::validation("x").status(), 400);
    assert_eq!(SeamError::not_found("x").status(), 404);
    assert_eq!(SeamError::internal("x").status(), 500);
    assert_eq!(SeamError::unauthorized("x").status(), 401);
    assert_eq!(SeamError::forbidden("x").status(), 403);
    assert_eq!(SeamError::rate_limited("x").status(), 429);
  }

  #[test]
  fn display_format() {
    let err = SeamError::not_found("missing");
    assert_eq!(err.to_string(), "NOT_FOUND: missing");
  }
}
