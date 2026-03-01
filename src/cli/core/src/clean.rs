/* src/cli/core/src/clean.rs */

// `seam clean` command: removes build output, codegen artifacts,
// and runs user-defined cleanup commands.

use std::path::Path;

use anyhow::{Context, Result};

use crate::config::{resolve_member_config, SeamConfig};
use crate::shell::run_command;
use crate::ui;

/// Run `seam clean` for a non-workspace project or workspace root.
pub fn run_clean(config: &SeamConfig, base_dir: &Path, member_filter: Option<&str>) -> Result<()> {
  if config.is_workspace() {
    run_workspace_clean(config, base_dir, member_filter)
  } else {
    if member_filter.is_some() {
      anyhow::bail!("--member flag requires a workspace project (add [workspace] to seam.toml)");
    }
    run_project_clean(config, base_dir)
  }
}

/// Clean a single (non-workspace) project.
fn run_project_clean(config: &SeamConfig, base_dir: &Path) -> Result<()> {
  ui::arrow("cleaning project");

  delete_out_dir(config, base_dir)?;
  delete_dist_dir(base_dir)?;
  delete_generate_dir(config, base_dir)?;
  run_clean_commands(&config.clean.commands, base_dir)?;

  ui::ok("clean complete");
  Ok(())
}

/// Clean workspace: either all members or a specific one.
fn run_workspace_clean(
  config: &SeamConfig,
  base_dir: &Path,
  member_filter: Option<&str>,
) -> Result<()> {
  if let Some(name) = member_filter {
    ui::arrow(&format!("cleaning member: {name}"));
    clean_single_member(config, base_dir, name)?;
  } else {
    ui::arrow("cleaning workspace");
    delete_out_dir(config, base_dir)?;
    delete_dist_dir(base_dir)?;
    delete_generate_dir(config, base_dir)?;
    run_clean_commands(&config.clean.commands, base_dir)?;

    for member_path in config.member_paths() {
      let dir = base_dir.join(member_path);
      let name = Path::new(member_path).file_name().and_then(|n| n.to_str()).unwrap_or(member_path);
      let member_config = resolve_member_config(config, &dir)?;
      ui::detail(&format!("cleaning member: {name}"));
      run_clean_commands(&member_config.clean.commands, &dir)?;
    }
  }

  ui::ok("clean complete");
  Ok(())
}

/// Clean a single workspace member: delete its subdirectory in out_dir, run its commands.
fn clean_single_member(config: &SeamConfig, base_dir: &Path, name: &str) -> Result<()> {
  let member_path = config
    .member_paths()
    .iter()
    .find(|p| Path::new(p.as_str()).file_name().and_then(|n| n.to_str()) == Some(name))
    .with_context(|| {
      let available: Vec<_> = config
        .member_paths()
        .iter()
        .filter_map(|p| Path::new(p.as_str()).file_name().and_then(|n| n.to_str()))
        .collect();
      format!("unknown member \"{name}\"\navailable members: {}", available.join(", "))
    })?;

  let dir = base_dir.join(member_path);
  let member_config = resolve_member_config(config, &dir)?;

  // Delete member subdirectory within out_dir
  let out_dir = config.build.out_dir.as_deref().unwrap_or(".seam/output");
  let member_out = base_dir.join(out_dir).join(name);
  delete_dir_if_exists(&member_out)?;

  run_clean_commands(&member_config.clean.commands, &dir)?;
  Ok(())
}

/// Delete the build output directory.
fn delete_out_dir(config: &SeamConfig, base_dir: &Path) -> Result<()> {
  let out_dir = config.build.out_dir.as_deref().unwrap_or(".seam/output");
  let path = base_dir.join(out_dir);
  delete_dir_if_exists(&path)
}

/// Delete the bundler intermediate output directory.
fn delete_dist_dir(base_dir: &Path) -> Result<()> {
  let path = base_dir.join(".seam/dist");
  delete_dir_if_exists(&path)
}

/// Delete the codegen output directory.
fn delete_generate_dir(config: &SeamConfig, base_dir: &Path) -> Result<()> {
  if let Some(ref gen_dir) = config.generate.out_dir {
    let path = base_dir.join(gen_dir);
    delete_dir_if_exists(&path)?;
  }
  Ok(())
}

fn delete_dir_if_exists(path: &Path) -> Result<()> {
  if path.exists() {
    std::fs::remove_dir_all(path)
      .with_context(|| format!("failed to remove {}", path.display()))?;
    ui::detail(&format!("deleted {}", path.display()));
  }
  Ok(())
}

fn run_clean_commands(commands: &[String], cwd: &Path) -> Result<()> {
  for cmd in commands {
    run_command(cwd, cmd, "clean", &[])?;
  }
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn parse_clean_section() {
    let toml_str = r#"
[project]
name = "my-app"

[clean]
commands = ["rm -rf dist", "cargo clean"]
"#;
    let config: SeamConfig = toml::from_str(toml_str).unwrap();
    assert_eq!(config.clean.commands, vec!["rm -rf dist", "cargo clean"]);
  }

  #[test]
  fn parse_no_clean_section() {
    let toml_str = r#"
[project]
name = "my-app"
"#;
    let config: SeamConfig = toml::from_str(toml_str).unwrap();
    assert!(config.clean.commands.is_empty());
  }

  #[test]
  fn delete_dir_if_exists_noop_on_missing() {
    let path = std::env::temp_dir().join("seam-test-clean-nonexistent");
    let _ = std::fs::remove_dir_all(&path);
    assert!(delete_dir_if_exists(&path).is_ok());
  }

  #[test]
  fn delete_dir_if_exists_removes_dir() {
    let path = std::env::temp_dir().join("seam-test-clean-exists");
    let _ = std::fs::remove_dir_all(&path);
    std::fs::create_dir_all(path.join("sub")).unwrap();
    std::fs::write(path.join("sub/file.txt"), "test").unwrap();

    assert!(path.exists());
    delete_dir_if_exists(&path).unwrap();
    assert!(!path.exists());
  }

  #[test]
  fn run_clean_deletes_out_and_generate_dirs() {
    let tmp = std::env::temp_dir().join("seam-test-run-clean");
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(&tmp).unwrap();

    // Create out_dir and generate dir
    let out = tmp.join(".seam/output");
    let gen = tmp.join("src/generated");
    std::fs::create_dir_all(&out).unwrap();
    std::fs::create_dir_all(&gen).unwrap();
    std::fs::write(out.join("data.json"), "{}").unwrap();
    std::fs::write(gen.join("client.ts"), "//").unwrap();

    let config: SeamConfig = toml::from_str(
      r#"
[project]
name = "test"

[generate]
out_dir = "src/generated"
"#,
    )
    .unwrap();

    run_project_clean(&config, &tmp).unwrap();
    assert!(!out.exists());
    assert!(!gen.exists());

    let _ = std::fs::remove_dir_all(&tmp);
  }

  #[test]
  fn workspace_clean_member_filter() {
    use std::io::Write;

    let tmp = std::env::temp_dir().join("seam-test-clean-ws-member");
    let _ = std::fs::remove_dir_all(&tmp);
    std::fs::create_dir_all(tmp.join("backends/ts-hono")).unwrap();

    // Write member seam.toml
    let mut f = std::fs::File::create(tmp.join("backends/ts-hono/seam.toml")).unwrap();
    writeln!(
      f,
      r#"[project]
name = "x"
[build]
router_file = "src/router.ts"
"#
    )
    .unwrap();

    // Create member output dir
    let member_out = tmp.join(".seam/output/ts-hono");
    std::fs::create_dir_all(&member_out).unwrap();
    std::fs::write(member_out.join("data.json"), "{}").unwrap();

    let config: SeamConfig = toml::from_str(
      r#"
[project]
name = "test"

[build]
out_dir = ".seam/output"

[workspace]
members = ["backends/ts-hono"]
"#,
    )
    .unwrap();

    clean_single_member(&config, &tmp, "ts-hono").unwrap();
    assert!(!member_out.exists());
    // Root out_dir still exists
    assert!(tmp.join(".seam/output").exists());

    let _ = std::fs::remove_dir_all(&tmp);
  }
}
