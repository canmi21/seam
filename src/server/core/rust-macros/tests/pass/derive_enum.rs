/* src/server/core/rust-macros/tests/pass/derive_enum.rs */

use seam_macros::SeamType;
use serde::{Deserialize, Serialize};

#[derive(SeamType, Serialize, Deserialize)]
enum Status {
  Active,
  Inactive,
  Pending,
}

fn main() {}
