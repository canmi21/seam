/* src/server/core/rust-macros/tests/fail/derive_tuple_struct.rs */

use seam_macros::SeamType;

#[derive(SeamType)]
struct Point(f64, f64);

fn main() {}
