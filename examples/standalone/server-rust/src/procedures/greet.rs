/* examples/standalone/server-rust/src/procedures/greet.rs */

use seam_server::{seam_procedure, SeamError, SeamType};
use serde::{Deserialize, Serialize};

#[derive(Deserialize, SeamType)]
pub struct GreetInput {
  pub name: String,
}

#[derive(Serialize, SeamType)]
pub struct GreetOutput {
  pub message: String,
}

#[seam_procedure]
pub async fn greet(input: GreetInput) -> Result<GreetOutput, SeamError> {
  Ok(GreetOutput { message: format!("Hello, {}!", input.name) })
}
