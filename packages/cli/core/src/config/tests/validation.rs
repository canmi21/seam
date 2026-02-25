/* packages/cli/core/src/config/tests/validation.rs */

use super::*;

#[test]
fn parse_i18n_section() {
  let toml_str = r#"
[project]
name = "my-app"

[i18n]
locales = ["origin", "zh"]
default = "zh"
messages_dir = "translations"
"#;
  let config: SeamConfig = toml::from_str(toml_str).unwrap();
  let i18n = config.i18n.unwrap();
  assert_eq!(i18n.locales, vec!["origin", "zh"]);
  assert_eq!(i18n.default, "zh");
  assert_eq!(i18n.messages_dir, "translations");
  assert!(i18n.validate().is_ok());
}

#[test]
fn parse_i18n_default_values() {
  let toml_str = r#"
[project]
name = "my-app"

[i18n]
locales = ["origin", "zh"]
"#;
  let config: SeamConfig = toml::from_str(toml_str).unwrap();
  let i18n = config.i18n.unwrap();
  assert_eq!(i18n.locales, vec!["origin", "zh"]);
  assert_eq!(i18n.default, "origin");
  assert_eq!(i18n.messages_dir, "locales");
}

#[test]
fn parse_no_i18n() {
  let toml_str = r#"
[project]
name = "my-app"
"#;
  let config: SeamConfig = toml::from_str(toml_str).unwrap();
  assert!(config.i18n.is_none());
}

#[test]
fn parse_i18n_validation_default_not_in_locales() {
  let toml_str = r#"
[project]
name = "my-app"

[i18n]
locales = ["origin", "zh"]
default = "ja"
"#;
  let config: SeamConfig = toml::from_str(toml_str).unwrap();
  let i18n = config.i18n.unwrap();
  let err = i18n.validate().unwrap_err();
  assert!(err.to_string().contains("\"ja\""));
  assert!(err.to_string().contains("not in"));
}

#[test]
fn parse_i18n_validation_empty_locales() {
  let toml_str = r#"
[project]
name = "my-app"

[i18n]
locales = []
"#;
  let config: SeamConfig = toml::from_str(toml_str).unwrap();
  let i18n = config.i18n.unwrap();
  let err = i18n.validate().unwrap_err();
  assert!(err.to_string().contains("must not be empty"));
}
