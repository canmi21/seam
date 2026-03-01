/* src/server/core/rust-macros/tests/pass/procedure_named.rs */

use seam_macros::seam_procedure;
use serde::{Deserialize, Serialize};

#[derive(seam_macros::SeamType, Serialize, Deserialize)]
struct In {
  x: i32,
}
#[derive(seam_macros::SeamType, Serialize, Deserialize)]
struct Out {
  y: i32,
}

#[seam_procedure(name = "customName")]
async fn my_proc(input: In) -> Result<Out, seam_server::SeamError> {
  Ok(Out { y: input.x + 1 })
}

fn main() {}
