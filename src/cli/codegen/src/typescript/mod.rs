/* src/cli/codegen/src/typescript/mod.rs */

mod generator;
mod render;

#[cfg(test)]
mod tests;

pub use generator::{generate_typescript, generate_typescript_meta};
