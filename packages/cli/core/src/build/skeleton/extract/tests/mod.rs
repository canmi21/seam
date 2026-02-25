/* packages/cli/core/src/build/skeleton/extract/tests/mod.rs */

use super::*;
use serde_json::json;

mod flat_axis;
mod legacy;
mod nested;
mod regression;

fn make_axis(path: &str, kind: &str, values: Vec<serde_json::Value>) -> Axis {
  Axis { path: path.to_string(), kind: kind.to_string(), values }
}
