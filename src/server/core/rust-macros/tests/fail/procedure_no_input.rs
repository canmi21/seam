/* src/server/core/rust-macros/tests/fail/procedure_no_input.rs */

use seam_macros::seam_procedure;

#[seam_procedure]
async fn bad() -> Result<String, seam_server::SeamError> {
  Ok("hello".to_string())
}

fn main() {}
