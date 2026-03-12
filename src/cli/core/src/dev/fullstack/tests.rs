/* src/cli/core/src/dev/fullstack/tests.rs */

use std::path::{Path, PathBuf};

use crate::build::config::BuildConfig;
use crate::build::run::RebuildMode;

use super::helpers::{DevEvent, classify_event, manifest_stale_reason, merge_dev_events};

fn test_build_config() -> BuildConfig {
	BuildConfig {
		output: crate::config::OutputMode::Hybrid,
		entry: "src/main.tsx".to_string(),
		routes: "./src/routes.ts".to_string(),
		out_dir: ".seam/dev-output".to_string(),
		renderer: "react".to_string(),
		backend_build_command: None,
		router_file: None,
		manifest_command: None,
		typecheck_command: None,
		is_fullstack: false,
		obfuscate: false,
		sourcemap: true,
		type_hint: true,
		hash_length: 12,
		rpc_salt: None,
		root_id: "__SEAM_ROOT__".to_string(),
		data_id: "__data".to_string(),
		pages_dir: None,
		i18n: None,
		config_path: None,
	}
}

fn make_manifest_json(version: &str, hash: &str) -> String {
	format!(r#"{{"_meta":{{"seam_version":"{version}","config_hash":"{hash}"}},"routes":{{}}}}"#)
}

#[test]
fn fresh_manifest_matching_meta() {
	let bc = test_build_config();
	let json = make_manifest_json(env!("CARGO_PKG_VERSION"), &bc.config_hash());
	assert!(manifest_stale_reason(&json, &bc).is_none());
}

#[test]
fn stale_manifest_wrong_version() {
	let bc = test_build_config();
	let json = make_manifest_json("0.0.0", &bc.config_hash());
	let reason = manifest_stale_reason(&json, &bc).unwrap();
	assert!(reason.contains("version changed"));
}

#[test]
fn classify_event_marks_public_changes_as_reload() {
	let event = notify::Event {
		kind: notify::EventKind::Modify(notify::event::ModifyKind::Any),
		paths: vec![PathBuf::from("/app/public/images/logo.png")],
		attrs: notify::event::EventAttributes::new(),
	};

	let kind = classify_event(&event, Path::new("/app/src/server"), Some(Path::new("/app/public")));
	assert!(matches!(kind, DevEvent::Reload));
}

#[test]
fn classify_event_marks_server_changes_as_full_rebuild() {
	let event = notify::Event {
		kind: notify::EventKind::Modify(notify::event::ModifyKind::Any),
		paths: vec![PathBuf::from("/app/src/server/index.ts")],
		attrs: notify::event::EventAttributes::new(),
	};

	let kind = classify_event(&event, Path::new("/app/src/server"), Some(Path::new("/app/public")));
	assert!(matches!(kind, DevEvent::Rebuild(RebuildMode::Full)));
}

#[test]
fn merge_dev_events_prefers_rebuild_over_reload() {
	let merged = merge_dev_events(DevEvent::Reload, DevEvent::Rebuild(RebuildMode::FrontendOnly));
	assert!(matches!(merged, DevEvent::Rebuild(RebuildMode::FrontendOnly)));
}

#[test]
fn stale_manifest_wrong_config() {
	let bc = test_build_config();
	let json = make_manifest_json(env!("CARGO_PKG_VERSION"), "0000000000000000");
	let reason = manifest_stale_reason(&json, &bc).unwrap();
	assert!(reason.contains("config changed"));
}

#[test]
fn stale_manifest_no_meta() {
	let bc = test_build_config();
	let json = r#"{"routes":{}}"#;
	let reason = manifest_stale_reason(json, &bc).unwrap();
	assert!(reason.contains("legacy"));
}

#[test]
fn stale_manifest_invalid_json() {
	let bc = test_build_config();
	let json = "not valid json {{{";
	assert!(manifest_stale_reason(json, &bc).is_some());
}
