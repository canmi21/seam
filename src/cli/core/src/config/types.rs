/* src/cli/core/src/config/types.rs */

use anyhow::{Result, bail};
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct SeamConfig {
  pub project: ProjectConfig,
  #[serde(default)]
  pub backend: BackendConfig,
  #[serde(default)]
  pub frontend: FrontendConfig,
  #[serde(default)]
  pub build: BuildSection,
  #[serde(default)]
  pub generate: GenerateSection,
  #[serde(default)]
  pub dev: DevSection,
  #[serde(default)]
  pub i18n: Option<I18nSection>,
  #[serde(default)]
  pub workspace: Option<WorkspaceSection>,
  #[serde(default)]
  pub clean: CleanSection,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WorkspaceSection {
  pub members: Vec<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct CleanSection {
  #[serde(default)]
  pub commands: Vec<String>,
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum I18nMode {
  #[default]
  Memory,
  Paged,
}

impl I18nMode {
  pub fn as_str(self) -> &'static str {
    match self {
      Self::Memory => "memory",
      Self::Paged => "paged",
    }
  }
}

#[derive(Debug, Clone, Deserialize)]
pub struct I18nSection {
  pub locales: Vec<String>,
  #[serde(default = "default_i18n_default")]
  pub default: String,
  #[serde(default = "default_messages_dir")]
  pub messages_dir: String,
  #[serde(default)]
  pub mode: I18nMode,
  #[serde(default)]
  pub cache: bool,
}

impl I18nSection {
  pub fn validate(&self) -> Result<()> {
    if self.locales.is_empty() {
      bail!("i18n.locales must not be empty");
    }
    if !self.locales.contains(&self.default) {
      bail!("i18n.default \"{}\" is not in i18n.locales {:?}", self.default, self.locales);
    }
    Ok(())
  }
}

fn default_i18n_default() -> String {
  "origin".to_string()
}

fn default_messages_dir() -> String {
  "locales".to_string()
}

#[derive(Debug, Clone, Deserialize)]
pub struct ProjectConfig {
  pub name: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct BackendConfig {
  #[serde(default = "default_lang")]
  pub lang: String,
  pub dev_command: Option<String>,
  #[serde(default = "default_port")]
  pub port: u16,
}

impl Default for BackendConfig {
  fn default() -> Self {
    Self { lang: default_lang(), dev_command: None, port: default_port() }
  }
}

#[derive(Debug, Clone, Deserialize)]
pub struct FrontendConfig {
  pub entry: Option<String>,
  pub dev_command: Option<String>,
  pub dev_port: Option<u16>,
  pub build_command: Option<String>,
  pub out_dir: Option<String>,
  #[serde(default = "default_root_id")]
  pub root_id: String,
  #[serde(default = "default_data_id")]
  pub data_id: String,
}

impl Default for FrontendConfig {
  fn default() -> Self {
    Self {
      entry: None,
      dev_command: None,
      dev_port: None,
      build_command: None,
      out_dir: None,
      root_id: default_root_id(),
      data_id: default_data_id(),
    }
  }
}

fn default_root_id() -> String {
  "__seam".to_string()
}

fn default_data_id() -> String {
  "__data".to_string()
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct BuildSection {
  pub routes: Option<String>,
  pub out_dir: Option<String>,
  pub bundler_command: Option<String>,
  pub bundler_manifest: Option<String>,
  pub renderer: Option<String>,
  pub backend_build_command: Option<String>,
  pub router_file: Option<String>,
  pub manifest_command: Option<String>,
  pub typecheck_command: Option<String>,
  #[serde(default)]
  pub obfuscate: Option<bool>,
  #[serde(default)]
  pub sourcemap: Option<bool>,
  #[serde(default)]
  pub type_hint: Option<bool>,
  #[serde(default)]
  pub hash_length: Option<u32>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct GenerateSection {
  pub out_dir: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DevSection {
  #[serde(default = "default_dev_port")]
  pub port: u16,
  pub vite_port: Option<u16>,
  #[serde(default)]
  pub obfuscate: Option<bool>,
  #[serde(default)]
  pub sourcemap: Option<bool>,
  #[serde(default)]
  pub type_hint: Option<bool>,
  #[serde(default)]
  pub hash_length: Option<u32>,
}

impl Default for DevSection {
  fn default() -> Self {
    Self {
      port: default_dev_port(),
      vite_port: None,
      obfuscate: None,
      sourcemap: None,
      type_hint: None,
      hash_length: None,
    }
  }
}

fn default_dev_port() -> u16 {
  80
}

fn default_lang() -> String {
  "typescript".to_string()
}

fn default_port() -> u16 {
  3000
}

impl SeamConfig {
  pub fn is_workspace(&self) -> bool {
    self.workspace.as_ref().is_some_and(|w| !w.members.is_empty())
  }

  pub fn member_paths(&self) -> &[String] {
    match &self.workspace {
      Some(w) => &w.members,
      None => &[],
    }
  }
}
