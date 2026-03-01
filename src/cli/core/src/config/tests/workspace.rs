/* src/cli/core/src/config/tests/workspace.rs */

use super::*;

#[test]
fn workspace_member_config_merge() {
  use std::io::Write;

  let tmp = std::env::temp_dir().join("seam-test-workspace-merge");
  let _ = std::fs::remove_dir_all(&tmp);
  std::fs::create_dir_all(tmp.join("backends/ts-hono")).unwrap();

  // Write member seam.toml
  let mut f = std::fs::File::create(tmp.join("backends/ts-hono/seam.toml")).unwrap();
  writeln!(
    f,
    r#"[project]
name = "ignored"

[backend]
lang = "typescript"
dev_command = "bun --watch src/index.ts"
port = 4000

[build]
backend_build_command = "bun build src/index.ts"
router_file = "src/router.ts"
"#
  )
  .unwrap();

  // Root config
  let root: SeamConfig = toml::from_str(
    r#"
[project]
name = "github-dashboard"

[frontend]
entry = "frontend/src/client/main.tsx"

[build]
routes = "frontend/src/client/routes.ts"
bundler_command = "cd frontend && bunx vite build"
bundler_manifest = "frontend/dist/.vite/manifest.json"
out_dir = ".seam/output"

[workspace]
members = ["backends/ts-hono"]
"#,
  )
  .unwrap();

  let merged = resolve_member_config(&root, &tmp.join("backends/ts-hono")).unwrap();

  // Project from root
  assert_eq!(merged.project.name, "github-dashboard");
  // Backend from member
  assert_eq!(merged.backend.lang, "typescript");
  assert_eq!(merged.backend.port, 4000);
  assert_eq!(merged.backend.dev_command.as_deref(), Some("bun --watch src/index.ts"));
  // Build: shared fields from root
  assert_eq!(merged.build.routes.as_deref(), Some("frontend/src/client/routes.ts"));
  assert_eq!(merged.build.bundler_command.as_deref(), Some("cd frontend && bunx vite build"));
  // Build: overridden fields from member
  assert_eq!(merged.build.backend_build_command.as_deref(), Some("bun build src/index.ts"));
  assert_eq!(merged.build.router_file.as_deref(), Some("src/router.ts"));
  // Workspace stripped from merged
  assert!(!merged.is_workspace());

  let _ = std::fs::remove_dir_all(&tmp);
}

#[test]
fn workspace_validation_missing_dir() {
  let tmp = std::env::temp_dir().join("seam-test-ws-missing-dir");
  let _ = std::fs::remove_dir_all(&tmp);
  std::fs::create_dir_all(&tmp).unwrap();

  let config: SeamConfig = toml::from_str(
    r#"
[project]
name = "test"

[workspace]
members = ["nonexistent"]
"#,
  )
  .unwrap();

  let err = validate_workspace(&config, &tmp).unwrap_err();
  assert!(err.to_string().contains("not found"));

  let _ = std::fs::remove_dir_all(&tmp);
}

#[test]
fn workspace_validation_missing_toml() {
  let tmp = std::env::temp_dir().join("seam-test-ws-missing-toml");
  let _ = std::fs::remove_dir_all(&tmp);
  std::fs::create_dir_all(tmp.join("member-a")).unwrap();

  let config: SeamConfig = toml::from_str(
    r#"
[project]
name = "test"

[workspace]
members = ["member-a"]
"#,
  )
  .unwrap();

  let err = validate_workspace(&config, &tmp).unwrap_err();
  assert!(err.to_string().contains("missing seam.toml"));

  let _ = std::fs::remove_dir_all(&tmp);
}

#[test]
fn workspace_validation_duplicate_names() {
  use std::io::Write;

  let tmp = std::env::temp_dir().join("seam-test-ws-dup-names");
  let _ = std::fs::remove_dir_all(&tmp);
  std::fs::create_dir_all(tmp.join("a/hono")).unwrap();
  std::fs::create_dir_all(tmp.join("b/hono")).unwrap();

  for dir in ["a/hono", "b/hono"] {
    let mut f = std::fs::File::create(tmp.join(dir).join("seam.toml")).unwrap();
    writeln!(
      f,
      r#"[project]
name = "x"

[build]
router_file = "src/router.ts"
"#
    )
    .unwrap();
  }

  let config: SeamConfig = toml::from_str(
    r#"
[project]
name = "test"

[build]
routes = "routes.ts"
bundler_command = "vite build"
bundler_manifest = "dist/manifest.json"

[workspace]
members = ["a/hono", "b/hono"]
"#,
  )
  .unwrap();

  let err = validate_workspace(&config, &tmp).unwrap_err();
  assert!(err.to_string().contains("duplicate"));

  let _ = std::fs::remove_dir_all(&tmp);
}

#[test]
fn workspace_validation_no_manifest_method() {
  use std::io::Write;

  let tmp = std::env::temp_dir().join("seam-test-ws-no-manifest");
  let _ = std::fs::remove_dir_all(&tmp);
  std::fs::create_dir_all(tmp.join("member")).unwrap();

  let mut f = std::fs::File::create(tmp.join("member/seam.toml")).unwrap();
  writeln!(
    f,
    r#"[project]
name = "x"

[backend]
lang = "rust"
"#
  )
  .unwrap();

  let config: SeamConfig = toml::from_str(
    r#"
[project]
name = "test"

[build]
routes = "routes.ts"
bundler_command = "vite build"
bundler_manifest = "dist/manifest.json"

[workspace]
members = ["member"]
"#,
  )
  .unwrap();

  let err = validate_workspace(&config, &tmp).unwrap_err();
  assert!(err.to_string().contains("router_file or build.manifest_command"));

  let _ = std::fs::remove_dir_all(&tmp);
}
