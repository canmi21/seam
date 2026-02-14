/* examples/server-rust/src/subscriptions/on_count.rs */

use seam_server::{BoxStream, SeamError, SeamType, SubscriptionDef};
use serde::{Deserialize, Serialize};

#[derive(Deserialize, SeamType)]
pub struct CountInput {
  pub max: i32,
}

#[derive(Serialize, SeamType)]
pub struct CountOutput {
  pub n: i32,
}

pub fn on_count_subscription() -> SubscriptionDef {
  SubscriptionDef {
    name: "onCount".to_string(),
    input_schema: CountInput::jtd_schema(),
    output_schema: CountOutput::jtd_schema(),
    handler: std::sync::Arc::new(|value: serde_json::Value| {
      Box::pin(async move {
        let input: CountInput = serde_json::from_value(value)
          .map_err(|e| SeamError::validation(e.to_string()))?;

        let stream = async_stream::stream! {
          for i in 1..=input.max {
            yield Ok(serde_json::to_value(CountOutput { n: i }).unwrap());
          }
        };

        Ok(Box::pin(stream) as BoxStream<Result<serde_json::Value, SeamError>>)
      })
    }),
  }
}
