//! The whole project in one call.
//!
//! Lowering runs at build time beside a compiler that is already Node, so it has to be reachable
//! from there. A native binary would mean a package per platform -- esbuild ships twenty six --
//! and a rewrite would mean maintaining the same thing twice. WebAssembly is neither: one file,
//! the same everywhere, and every runtime that could host the build already interprets it.
//!
//! **The unit is the project, not the component.** Measured across a thousand components, the
//! work itself is 49ms and starting a process a thousand times is 2.1 seconds, so what was
//! expensive was never the lowering. Crossing into linear memory costs 0.32ms for five megabytes,
//! which is a `memcpy`, so one call with everything in it makes the boundary disappear.
//!
//! No bindings generator is involved. Those exist to carry structs and closures across, and what
//! goes across here is bytes. So there is no glue to name and none to be unhappy about: the host
//! side is twenty lines that this crate does not own.

use std::alloc::{Layout, alloc};

use serde::Serialize;

use crate::assemble::{Skeleton, assemble};

/// What one component compiled to, or why it did not.
#[derive(Serialize)]
#[serde(untagged)]
enum Outcome {
	Compiled(crate::ir::Compiled),
	/// Carried rather than thrown, so one component that will not compile still says which one it
	/// was and the rest of the project is still reported on.
	Failed {
		name: String,
		error: String,
	},
}

/// Hands back a region the host can write into. Paired with nothing: the batch is read once and
/// the instance is thrown away, so freeing it would cost more than the page it sits on.
///
/// # Safety
/// The caller writes exactly `len` bytes and passes the same `len` back to `lower`.
#[unsafe(no_mangle)]
pub extern "C" fn allocate(len: usize) -> *mut u8 {
	if len == 0 {
		return std::ptr::null_mut();
	}
	// SAFETY: a byte alignment is valid for any non-zero size.
	unsafe { alloc(Layout::from_size_align_unchecked(len, 1)) }
}

static mut OUT: (usize, usize) = (0, 0);

/// Where the last `lower` left its result.
#[unsafe(no_mangle)]
pub extern "C" fn out_ptr() -> usize {
	// SAFETY: written only by `lower`, and wasm has one thread.
	unsafe { OUT.0 }
}

/// How long it is.
#[unsafe(no_mangle)]
pub extern "C" fn out_len() -> usize {
	// SAFETY: as above.
	unsafe { OUT.1 }
}

/// Compiles every skeleton in the batch.
///
/// Takes `[[name, skeleton], ...]` as JSON and leaves an array of the same length behind, each
/// entry either what the component compiled to or a record of why it did not. Returns zero when
/// the batch itself could be read, and one when it could not.
///
/// # Safety
/// `ptr` and `len` must name a region written by `allocate`.
#[unsafe(no_mangle)]
pub extern "C" fn lower(ptr: *mut u8, len: usize) -> i32 {
	// SAFETY: the host wrote this region and has not touched it since.
	let input = unsafe { std::slice::from_raw_parts(ptr, len) };
	let Ok(batch) = serde_json::from_slice::<Vec<(String, String)>>(input) else {
		return 1;
	};

	let outcomes: Vec<Outcome> = batch
		.into_iter()
		.map(|(name, skeleton)| match serde_json::from_str::<Skeleton>(&skeleton) {
			Err(error) => {
				Outcome::Failed { name, error: format!("the skeleton does not parse: {error}") }
			}
			Ok(parsed) => match assemble(&name, &parsed) {
				Ok(compiled) => Outcome::Compiled(compiled),
				Err(error) => Outcome::Failed { name, error },
			},
		})
		.collect();

	let Ok(bytes) = serde_json::to_vec(&outcomes) else {
		return 1;
	};
	let boxed = bytes.into_boxed_slice();
	let length = boxed.len();
	let raw = Box::into_raw(boxed).cast::<u8>();
	// SAFETY: as above; one thread, and the host reads it before calling again.
	unsafe { OUT = (raw as usize, length) };
	0
}
