/* src/server/core/rust-macros/tests/pass/procedure_basic.rs */

use seam_macros::seam_procedure;
use serde::{Deserialize, Serialize};

#[derive(seam_macros::SeamType, Serialize, Deserialize)]
struct Input {
  name: String,
}
#[derive(seam_macros::SeamType, Serialize, Deserialize)]
struct Output {
  message: String,
}

#[seam_procedure]
async fn greet(input: Input) -> Result<Output, seam_server::SeamError> {
  Ok(Output { message: format!("Hello, {}!", input.name) })
}

fn main() {}
