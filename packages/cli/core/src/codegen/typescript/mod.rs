/* packages/cli/core/src/codegen/typescript/mod.rs */

mod generator;
mod render;

#[cfg(test)]
mod tests;

pub use generator::{generate_typescript, generate_typescript_meta};
