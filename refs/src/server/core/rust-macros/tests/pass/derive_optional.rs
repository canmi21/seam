/* src/server/core/rust-macros/tests/pass/derive_optional.rs */

use seam_macros::SeamType;
use serde::{Deserialize, Serialize};

#[derive(SeamType, Serialize, Deserialize)]
struct Profile {
  name: String,
  bio: Option<String>,
  #[seam(optional)]
  nickname: Option<String>,
}

fn main() {}
