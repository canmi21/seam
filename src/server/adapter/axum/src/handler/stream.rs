/* src/server/adapter/axum/src/handler/stream.rs */

use std::convert::Infallible;
use std::pin::Pin;

use axum::response::sse::{Event, Sse};
use futures_core::Stream;
use seam_server::SeamError;
use tokio_stream::StreamExt;

use super::{AppState, resolve_ctx_for_proc};

/// Handles a stream procedure — SSE with incrementing `id` on data events.
pub(super) async fn handle_stream_inner(
	state: &AppState,
	name: &str,
	headers: &axum::http::HeaderMap,
	uri: &axum::http::Uri,
	body: &[u8],
) -> Sse<Pin<Box<dyn Stream<Item = Result<Event, Infallible>> + Send>>> {
	let setup = async {
		let stream = state
			.streams
			.get(name)
			.ok_or_else(|| SeamError::not_found(format!("Stream '{name}' not found")))?;

		let input: serde_json::Value =
			serde_json::from_slice(body).map_err(|e| SeamError::validation(e.to_string()))?;

		if state.should_validate
			&& let Some(cs) = state.compiled_stream_input_schemas.get(name)
			&& let Err((msg, details)) = seam_server::validate_compiled(cs, &input)
		{
			let detail_json = details.iter().map(seam_server::ValidationDetail::to_json).collect();
			return Err(SeamError::validation_detailed(
				format!("Input validation failed for stream '{name}': {msg}"),
				detail_json,
			));
		}

		let ctx = resolve_ctx_for_proc(state, &stream.context_keys, headers, uri)?;
		let data_stream = (stream.handler)(input, ctx).await?;
		Ok::<_, SeamError>(data_stream)
	};

	match setup.await {
		Ok(data_stream) => {
			let mut seq: u64 = 0;
			let event_stream = data_stream.map(move |item| {
				let id = seq;
				seq += 1;
				match item {
					Ok(value) => {
						let data = serde_json::to_string(&value).unwrap_or_default();
						Ok(Event::default().event("data").id(id.to_string()).data(data))
					}
					Err(e) => {
						let mut payload = serde_json::json!({
							"code": e.code(), "message": e.message(), "transient": false
						});
						if let Some(details) = e.details() {
							payload["details"] = serde_json::Value::Array(details.to_vec());
						}
						Ok(Event::default().event("error").data(payload.to_string()))
					}
				}
			});
			let stream = super::sse_lifecycle::with_sse_lifecycle(
				Box::pin(event_stream),
				state.heartbeat_interval,
				state.sse_idle_timeout,
			);
			Sse::new(stream)
		}
		Err(err) => {
			let mut payload =
				serde_json::json!({ "code": err.code(), "message": err.message(), "transient": false });
			if let Some(details) = err.details() {
				payload["details"] = serde_json::Value::Array(details.to_vec());
			}
			let error_event = Event::default().event("error").data(payload.to_string());
			Sse::new(Box::pin(tokio_stream::once(Ok(error_event))))
		}
	}
}
