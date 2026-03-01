/* src/server/core/rust-macros/tests/pass/derive_struct.rs */

use seam_macros::SeamType;
use serde::{Deserialize, Serialize};

#[derive(SeamType, Serialize, Deserialize)]
struct GreetInput {
  name: String,
  count: i32,
}

fn main() {}
