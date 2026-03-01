/* src/server/core/rust-macros/tests/pass/command_with_error.rs */

use seam_macros::{SeamType, seam_command};
use serde::{Deserialize, Serialize};

#[derive(SeamType, Serialize, Deserialize)]
struct CmdInput {
  id: i32,
}
#[derive(SeamType, Serialize, Deserialize)]
struct CmdOutput {
  deleted: bool,
}
#[derive(SeamType, Serialize, Deserialize)]
enum CmdError {
  NotFound,
  Forbidden,
}

#[seam_command(error = CmdError)]
async fn delete_item(_input: CmdInput) -> Result<CmdOutput, seam_server::SeamError> {
  Ok(CmdOutput { deleted: true })
}

fn main() {}
