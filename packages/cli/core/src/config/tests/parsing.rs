/* packages/cli/core/src/config/tests/parsing.rs */

use super::*;

#[test]
fn parse_minimal_config() {
  let toml_str = r#"
[project]
name = "my-app"
"#;
  let config: SeamConfig = toml::from_str(toml_str).unwrap();
  assert_eq!(config.project.name, "my-app");
  assert_eq!(config.backend.port, 3000);
  assert_eq!(config.backend.lang, "typescript");
  assert!(config.backend.dev_command.is_none());
  assert!(config.frontend.dev_command.is_none());
}

#[test]
fn parse_full_config() {
  let toml_str = r#"
[project]
name = "full-app"

[backend]
lang = "rust"
dev_command = "cargo watch -x run"
port = 8080

[frontend]
dev_command = "vite dev"
dev_port = 5173
build_command = "vite build"
out_dir = "dist"

[build]
routes = "./src/routes.ts"
out_dir = "dist"
bundler_command = "npx vite build"
bundler_manifest = "dist/.vite/manifest.json"
renderer = "react"

[generate]
out_dir = "src/generated"
"#;
  let config: SeamConfig = toml::from_str(toml_str).unwrap();
  assert_eq!(config.project.name, "full-app");
  assert_eq!(config.backend.lang, "rust");
  assert_eq!(config.backend.port, 8080);
  assert_eq!(config.backend.dev_command.as_deref(), Some("cargo watch -x run"));
  assert_eq!(config.frontend.dev_port, Some(5173));
  assert_eq!(config.build.renderer.as_deref(), Some("react"));
  assert_eq!(config.generate.out_dir.as_deref(), Some("src/generated"));
}

#[test]
fn parse_fullstack_build_config() {
  let toml_str = r#"
[project]
name = "fullstack-app"

[build]
routes = "./src/routes.ts"
bundler_command = "bunx vite build"
bundler_manifest = "dist/.vite/manifest.json"
out_dir = ".seam/output"
backend_build_command = "bun build src/server/index.ts --target=bun --outdir=.seam/output/server"
router_file = "src/server/router.ts"
typecheck_command = "bunx tsc --noEmit"
"#;
  let config: SeamConfig = toml::from_str(toml_str).unwrap();
  assert_eq!(
    config.build.backend_build_command.as_deref(),
    Some("bun build src/server/index.ts --target=bun --outdir=.seam/output/server")
  );
  assert_eq!(config.build.router_file.as_deref(), Some("src/server/router.ts"));
  assert_eq!(config.build.typecheck_command.as_deref(), Some("bunx tsc --noEmit"));
}

#[test]
fn parse_builtin_bundler_config() {
  let toml_str = r#"
[project]
name = "builtin-app"

[frontend]
entry = "src/client/main.tsx"
dev_port = 5173

[build]
routes = "./src/routes.ts"
out_dir = ".seam/output"
backend_build_command = "bun build src/server/index.ts --target=bun --outdir=.seam/output/server"
router_file = "src/server/router.ts"
"#;
  let config: SeamConfig = toml::from_str(toml_str).unwrap();
  assert_eq!(config.frontend.entry.as_deref(), Some("src/client/main.tsx"));
  assert!(config.build.bundler_command.is_none());
  assert!(config.build.bundler_manifest.is_none());
}

#[test]
fn parse_dev_section_defaults() {
  let toml_str = r#"
[project]
name = "my-app"
"#;
  let config: SeamConfig = toml::from_str(toml_str).unwrap();
  assert_eq!(config.dev.port, 80);
}

#[test]
fn parse_dev_section_explicit() {
  let toml_str = r#"
[project]
name = "my-app"

[dev]
port = 3000
"#;
  let config: SeamConfig = toml::from_str(toml_str).unwrap();
  assert_eq!(config.dev.port, 3000);
}

#[test]
fn parse_dev_section_with_vite_port() {
  let toml_str = r#"
[project]
name = "my-app"

[dev]
port = 3000
vite_port = 5173
"#;
  let config: SeamConfig = toml::from_str(toml_str).unwrap();
  assert_eq!(config.dev.port, 3000);
  assert_eq!(config.dev.vite_port, Some(5173));
}

#[test]
fn parse_dev_section_vite_port_defaults_to_none() {
  let toml_str = r#"
[project]
name = "my-app"
"#;
  let config: SeamConfig = toml::from_str(toml_str).unwrap();
  assert!(config.dev.vite_port.is_none());
}

#[test]
fn parse_obfuscate_config() {
  // Explicit values
  let toml_str = r#"
[project]
name = "my-app"

[build]
obfuscate = false
sourcemap = true

[dev]
obfuscate = true
sourcemap = false
"#;
  let config: SeamConfig = toml::from_str(toml_str).unwrap();
  assert_eq!(config.build.obfuscate, Some(false));
  assert_eq!(config.build.sourcemap, Some(true));
  assert_eq!(config.dev.obfuscate, Some(true));
  assert_eq!(config.dev.sourcemap, Some(false));

  // Defaults to None when omitted
  let toml_str = r#"
[project]
name = "my-app"
"#;
  let config: SeamConfig = toml::from_str(toml_str).unwrap();
  assert!(config.build.obfuscate.is_none());
  assert!(config.build.sourcemap.is_none());
  assert!(config.dev.obfuscate.is_none());
  assert!(config.dev.sourcemap.is_none());
}

#[test]
fn parse_type_hint_config() {
  // Explicit values
  let toml_str = r#"
[project]
name = "my-app"

[build]
type_hint = false

[dev]
type_hint = true
"#;
  let config: SeamConfig = toml::from_str(toml_str).unwrap();
  assert_eq!(config.build.type_hint, Some(false));
  assert_eq!(config.dev.type_hint, Some(true));

  // Defaults to None when omitted
  let toml_str = r#"
[project]
name = "my-app"
"#;
  let config: SeamConfig = toml::from_str(toml_str).unwrap();
  assert!(config.build.type_hint.is_none());
  assert!(config.dev.type_hint.is_none());
}

#[test]
fn parse_hash_length_config() {
  // Explicit values
  let toml_str = r#"
[project]
name = "my-app"

[build]
hash_length = 20

[dev]
hash_length = 8
"#;
  let config: SeamConfig = toml::from_str(toml_str).unwrap();
  assert_eq!(config.build.hash_length, Some(20));
  assert_eq!(config.dev.hash_length, Some(8));

  // Defaults to None when omitted
  let toml_str = r#"
[project]
name = "my-app"
"#;
  let config: SeamConfig = toml::from_str(toml_str).unwrap();
  assert!(config.build.hash_length.is_none());
  assert!(config.dev.hash_length.is_none());
}

#[test]
fn parse_root_id_default() {
  let toml_str = r#"
[project]
name = "my-app"
"#;
  let config: SeamConfig = toml::from_str(toml_str).unwrap();
  assert_eq!(config.frontend.root_id, "__seam");
}

#[test]
fn parse_root_id_explicit() {
  let toml_str = r#"
[project]
name = "my-app"

[frontend]
root_id = "app"
"#;
  let config: SeamConfig = toml::from_str(toml_str).unwrap();
  assert_eq!(config.frontend.root_id, "app");
}

#[test]
fn parse_data_id_default() {
  let toml_str = r#"
[project]
name = "my-app"
"#;
  let config: SeamConfig = toml::from_str(toml_str).unwrap();
  assert_eq!(config.frontend.data_id, "__data");
}

#[test]
fn parse_data_id_explicit() {
  let toml_str = r#"
[project]
name = "my-app"

[frontend]
data_id = "__sd"
"#;
  let config: SeamConfig = toml::from_str(toml_str).unwrap();
  assert_eq!(config.frontend.data_id, "__sd");
}

#[test]
fn parse_workspace_config() {
  let toml_str = r#"
[project]
name = "github-dashboard"

[workspace]
members = ["backends/ts-hono", "backends/rust-axum", "backends/go-gin"]
"#;
  let config: SeamConfig = toml::from_str(toml_str).unwrap();
  assert!(config.is_workspace());
  assert_eq!(config.member_paths(), &["backends/ts-hono", "backends/rust-axum", "backends/go-gin"]);
}

#[test]
fn parse_no_workspace() {
  let toml_str = r#"
[project]
name = "my-app"
"#;
  let config: SeamConfig = toml::from_str(toml_str).unwrap();
  assert!(!config.is_workspace());
  assert!(config.member_paths().is_empty());
}

#[test]
fn parse_manifest_command() {
  let toml_str = r#"
[project]
name = "my-app"

[build]
manifest_command = "cargo run --release -- --manifest"
backend_build_command = "cargo build --release"
routes = "frontend/src/client/routes.ts"
bundler_command = "cd frontend && bunx vite build"
bundler_manifest = "frontend/dist/.vite/manifest.json"
"#;
  let config: SeamConfig = toml::from_str(toml_str).unwrap();
  assert_eq!(config.build.manifest_command.as_deref(), Some("cargo run --release -- --manifest"));
  assert!(config.build.router_file.is_none());
}

#[test]
fn missing_project_errors() {
  let toml_str = r#"
[backend]
port = 3000
"#;
  let result = toml::from_str::<SeamConfig>(toml_str);
  assert!(result.is_err());
}
