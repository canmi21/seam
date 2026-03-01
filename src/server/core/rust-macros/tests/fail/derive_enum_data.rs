/* src/server/core/rust-macros/tests/fail/derive_enum_data.rs */

use seam_macros::SeamType;

#[derive(SeamType)]
enum Shape {
  Circle(f64),
  Rectangle { width: f64, height: f64 },
}

fn main() {}
