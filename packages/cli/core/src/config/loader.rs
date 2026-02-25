/* packages/cli/core/src/config/loader.rs */

use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};

use super::SeamConfig;

/// Walk upward from `start` to find `seam.toml`, like Cargo.toml discovery
pub fn find_seam_config(start: &Path) -> Result<PathBuf> {
  let mut dir =
    start.canonicalize().with_context(|| format!("failed to canonicalize {}", start.display()))?;
  loop {
    let candidate = dir.join("seam.toml");
    if candidate.is_file() {
      return Ok(candidate);
    }
    if !dir.pop() {
      bail!("seam.toml not found (searched upward from {})", start.display());
    }
  }
}

pub fn load_seam_config(path: &Path) -> Result<SeamConfig> {
  let content =
    std::fs::read_to_string(path).with_context(|| format!("failed to read {}", path.display()))?;
  let config: SeamConfig =
    toml::from_str(&content).with_context(|| format!("failed to parse {}", path.display()))?;
  if let Some(ref i18n) = config.i18n {
    i18n.validate()?;
  }
  Ok(config)
}

/// Load and merge root + member config.
/// Member overrides: [backend], [build].{backend_build_command, router_file, manifest_command, out_dir}
/// Root provides: [project], [frontend], [build] (shared fields), [i18n], [dev], [generate]
pub fn resolve_member_config(root: &SeamConfig, member_dir: &Path) -> Result<SeamConfig> {
  let member_toml = member_dir.join("seam.toml");
  let content = std::fs::read_to_string(&member_toml)
    .with_context(|| format!("failed to read {}", member_toml.display()))?;
  let member: SeamConfig = toml::from_str(&content)
    .with_context(|| format!("failed to parse {}", member_toml.display()))?;

  let mut merged = root.clone();

  // Backend entirely from member
  merged.backend = member.backend;

  // Build: member overrides backend-specific fields only
  if member.build.backend_build_command.is_some() {
    merged.build.backend_build_command = member.build.backend_build_command;
  }
  if member.build.router_file.is_some() {
    merged.build.router_file = member.build.router_file;
  }
  if member.build.manifest_command.is_some() {
    merged.build.manifest_command = member.build.manifest_command;
  }
  if member.build.out_dir.is_some() {
    merged.build.out_dir = member.build.out_dir;
  }

  // Clean section from member (not merged with root)
  merged.clean = member.clean;

  // Strip workspace section from merged config (members are not workspaces)
  merged.workspace = None;

  Ok(merged)
}

/// Validate workspace: member dirs exist, contain seam.toml, no duplicates,
/// each member has either router_file or manifest_command.
pub fn validate_workspace(config: &SeamConfig, base_dir: &Path) -> Result<()> {
  let members = config.member_paths();
  if members.is_empty() {
    bail!("workspace.members must not be empty");
  }

  let mut seen_names = std::collections::HashSet::new();
  for member_path in members {
    let dir = base_dir.join(member_path);
    if !dir.is_dir() {
      bail!("workspace member directory not found: {}", dir.display());
    }
    let toml_path = dir.join("seam.toml");
    if !toml_path.is_file() {
      bail!("workspace member missing seam.toml: {}", toml_path.display());
    }

    // Extract basename for duplicate check
    let name = Path::new(member_path).file_name().and_then(|n| n.to_str()).unwrap_or(member_path);
    if !seen_names.insert(name.to_string()) {
      bail!("duplicate workspace member name: {name}");
    }

    // Load and check manifest extraction method
    let member_config = resolve_member_config(config, &dir)?;
    if member_config.build.router_file.is_none() && member_config.build.manifest_command.is_none() {
      bail!(
        "workspace member \"{member_path}\" must have either build.router_file or build.manifest_command"
      );
    }
  }

  Ok(())
}
