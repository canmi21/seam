/* src/server/core/rust-macros/tests/fail/procedure_no_return.rs */

use seam_macros::seam_procedure;

#[seam_procedure]
async fn bad(input: String) {}

fn main() {}
