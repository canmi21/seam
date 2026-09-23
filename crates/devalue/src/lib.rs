//! devalue, in Rust, byte for byte with the JavaScript package of the same version.
//!
//! `JSON.stringify` loses a `Date` to a string, a `Set` to an empty object and an `undefined`
//! entirely. devalue carries them, and its output is still JSON, so a payload serialized with it
//! can sit in a script element the browser will not execute.
//!
//! This exists because the format is the contract between a server written in any language and a
//! browser running the JavaScript one. Reproducing it is what lets a backend that is not Node
//! hand a page its data. The version tracks the package it agrees with, because agreeing with a
//! particular version is the only claim it can make: devalue's own non-goals include stability of
//! the serialization mechanism between versions.
//!
//! What is here is `stringify` and `uneval`. `parse` runs in the browser, where the real one
//! already is, and is absent rather than approximated. `uneval` produces executable source, which a
//! payload this protocol chooses is never written as; it is here because Svelte writes one -- the
//! script `hydratable` values reach the client through -- and those bytes are Svelte's to decide.

mod escape;
mod number;
mod stringify;
mod uneval;
mod value;

pub use stringify::stringify;
pub use uneval::uneval;
pub use value::Value;
