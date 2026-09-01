/* src/server/core/rust-macros/tests/pass/command_basic.rs */

use seam_macros::seam_command;
use serde::{Deserialize, Serialize};

#[derive(seam_macros::SeamType, Serialize, Deserialize)]
struct UpdateInput {
  value: String,
}
#[derive(seam_macros::SeamType, Serialize, Deserialize)]
struct UpdateOutput {
  success: bool,
}

#[seam_command]
async fn update(_input: UpdateInput) -> Result<UpdateOutput, seam_server::SeamError> {
  Ok(UpdateOutput { success: true })
}

fn main() {}
