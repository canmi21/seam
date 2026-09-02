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
//! What is here is `stringify`. `parse` runs in the browser, where the real one already is, and
//! `uneval` produces executable source, which is the thing a payload in a document should not be.
//! Both are absent rather than approximated.

mod escape;
mod number;
mod stringify;
mod value;

pub use stringify::stringify;
pub use value::Value;
