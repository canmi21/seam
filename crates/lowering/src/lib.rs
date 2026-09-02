pub mod assemble;
pub mod attributes;
pub mod ir;
pub mod lower;
pub mod markup;

// The build-time entry point for a host that is not Rust. Only compiled for the target it exists
// for, so a native build is unaffected by it.
#[cfg(target_arch = "wasm32")]
mod wasm;

pub use assemble::assemble;
pub use lower::lower;
