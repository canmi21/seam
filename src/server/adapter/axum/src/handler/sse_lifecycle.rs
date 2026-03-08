/* src/server/adapter/axum/src/handler/sse_lifecycle.rs */

use std::convert::Infallible;
use std::pin::Pin;
use std::time::Duration;

use axum::response::sse::Event;
use futures_core::Stream;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;

/// Wrap a data SSE stream with heartbeat comments and idle timeout.
///
/// - Emits `: heartbeat\n\n` every `heartbeat_interval`
/// - Tracks idle time since last **data** event (heartbeat does NOT reset)
/// - On idle timeout: yields `event: complete` then ends
/// - On natural stream end: yields `event: complete` then ends
pub(super) fn with_sse_lifecycle(
	data_stream: Pin<Box<dyn Stream<Item = Result<Event, Infallible>> + Send>>,
	heartbeat_interval: Duration,
	idle_timeout: Duration,
) -> Pin<Box<dyn Stream<Item = Result<Event, Infallible>> + Send>> {
	let (tx, rx) = mpsc::channel::<Result<Event, Infallible>>(32);

	tokio::spawn(async move {
		use tokio_stream::StreamExt;

		let mut data_stream = data_stream;
		let mut heartbeat = tokio::time::interval(heartbeat_interval);
		// Skip the first immediate tick
		heartbeat.tick().await;

		let idle_enabled = idle_timeout > Duration::ZERO;
		let idle_sleep = tokio::time::sleep(idle_timeout);
		tokio::pin!(idle_sleep);

		loop {
			tokio::select! {
				item = StreamExt::next(&mut data_stream) => {
					match item {
						Some(event) => {
							// Reset idle timer on data events
							if idle_enabled {
								idle_sleep.as_mut().reset(tokio::time::Instant::now() + idle_timeout);
							}
							if tx.send(event).await.is_err() {
								break;
							}
						}
						None => {
							// Natural stream end: send complete
							let complete = Event::default().event("complete").data("{}");
							let _ = tx.send(Ok(complete)).await;
							break;
						}
					}
				}
				_ = heartbeat.tick() => {
					// SSE comment line (not a named event -- colon prefix)
					let comment = Event::default().comment("heartbeat");
					if tx.send(Ok(comment)).await.is_err() {
						break;
					}
				}
				_ = &mut idle_sleep, if idle_enabled => {
					// Idle timeout: send complete and end
					let complete = Event::default().event("complete").data("{}");
					let _ = tx.send(Ok(complete)).await;
					break;
				}
			}
		}
	});

	Box::pin(ReceiverStream::new(rx))
}
