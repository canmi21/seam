/* src/cli/codegen/src/typescript/mod.rs */

mod generator;
mod render;

#[cfg(test)]
mod tests;

pub use generator::{generate_hooks_module, generate_type_declarations, generate_typescript};
