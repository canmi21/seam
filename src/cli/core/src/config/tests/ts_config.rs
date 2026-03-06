/* src/cli/core/src/config/tests/ts_config.rs */

use super::*;
use loader::{find_config_in_dir, find_seam_config, load_seam_config};

// -- camel_to_snake_keys transformation --

#[test]
fn camel_to_snake_all_fields() {
	let input: serde_json::Value = serde_json::json!({
		"project": { "name": "test" },
		"backend": { "devCommand": "bun run", "port": 3000 },
		"frontend": {
			"devCommand": "vite",
			"devPort": 5173,
			"buildCommand": "vite build",
			"outDir": "dist",
			"rootId": "__app",
			"dataId": "__d"
		},
		"build": {
			"outDir": ".seam/output",
			"bundlerCommand": "vite build",
			"bundlerManifest": "dist/manifest.json",
			"backendBuildCommand": "bun build",
			"routerFile": "router.ts",
			"manifestCommand": "cargo run",
			"typecheckCommand": "tsc",
			"typeHint": true,
			"hashLength": 16,
			"pagesDir": "src/pages"
		},
		"generate": { "outDir": "gen" },
		"dev": {
			"port": 3000,
			"vitePort": 5173,
			"typeHint": false,
			"hashLength": 8
		},
		"i18n": { "locales": ["en"], "default": "en", "messagesDir": "msgs" }
	});

	let result = loader::prepare_ts_config(input);

	// Nested camelCase keys should be snake_case
	assert_eq!(result["backend"]["dev_command"], "bun run");
	assert_eq!(result["frontend"]["dev_command"], "vite");
	assert_eq!(result["frontend"]["dev_port"], 5173);
	assert_eq!(result["frontend"]["build_command"], "vite build");
	assert_eq!(result["frontend"]["out_dir"], "dist");
	assert_eq!(result["frontend"]["root_id"], "__app");
	assert_eq!(result["frontend"]["data_id"], "__d");
	assert_eq!(result["build"]["out_dir"], ".seam/output");
	assert_eq!(result["build"]["bundler_command"], "vite build");
	assert_eq!(result["build"]["bundler_manifest"], "dist/manifest.json");
	assert_eq!(result["build"]["backend_build_command"], "bun build");
	assert_eq!(result["build"]["router_file"], "router.ts");
	assert_eq!(result["build"]["manifest_command"], "cargo run");
	assert_eq!(result["build"]["typecheck_command"], "tsc");
	assert_eq!(result["build"]["type_hint"], true);
	assert_eq!(result["build"]["hash_length"], 16);
	assert_eq!(result["build"]["pages_dir"], "src/pages");
	assert_eq!(result["generate"]["out_dir"], "gen");
	assert_eq!(result["dev"]["vite_port"], 5173);
	assert_eq!(result["dev"]["type_hint"], false);
	assert_eq!(result["dev"]["hash_length"], 8);
	assert_eq!(result["i18n"]["messages_dir"], "msgs");
}

#[test]
fn camel_to_snake_single_word_keys_unchanged() {
	let input: serde_json::Value = serde_json::json!({
		"project": { "name": "test" },
		"backend": { "lang": "typescript", "port": 3000 },
		"dev": { "port": 80 }
	});

	let result = loader::prepare_ts_config(input);

	assert_eq!(result["backend"]["lang"], "typescript");
	assert_eq!(result["backend"]["port"], 3000);
	assert_eq!(result["dev"]["port"], 80);
}

#[test]
fn vite_and_router_passthrough() {
	let input: serde_json::Value = serde_json::json!({
		"project": { "name": "test" },
		"vite": {
			"resolve": {
				"alias": { "@": "./src" }
			},
			"css": {
				"postcss": { "plugins": [] }
			}
		},
		"router": {
			"routeFilePrefix": "~",
			"autoCodeSplitting": true
		}
	});

	let result = loader::prepare_ts_config(input);

	// vite and router keys should NOT be snake_cased
	assert_eq!(result["vite"]["resolve"]["alias"]["@"], "./src");
	assert_eq!(result["vite"]["css"]["postcss"]["plugins"], serde_json::json!([]));
	assert_eq!(result["router"]["routeFilePrefix"], "~");
	assert_eq!(result["router"]["autoCodeSplitting"], true);
}

// -- prepare_ts_config round-trip deserialization --

#[test]
fn prepare_ts_config_deserializes_to_seam_config() {
	let input: serde_json::Value = serde_json::json!({
		"project": { "name": "round-trip" },
		"backend": { "devCommand": "bun run", "port": 4000 },
		"frontend": { "entry": "main.tsx", "rootId": "app" },
		"build": { "pagesDir": "src/pages", "outDir": ".seam/output" }
	});

	let transformed = loader::prepare_ts_config(input);
	let config: SeamConfig = serde_json::from_value(transformed).unwrap();

	assert_eq!(config.project_name(), "round-trip");
	assert_eq!(config.backend.dev_command.as_deref(), Some("bun run"));
	assert_eq!(config.backend.port, 4000);
	assert_eq!(config.frontend.entry.as_deref(), Some("main.tsx"));
	assert_eq!(config.frontend.root_id, "app");
	assert_eq!(config.build.pages_dir.as_deref(), Some("src/pages"));
}

#[test]
fn vite_router_round_trip_as_json_value() {
	let input: serde_json::Value = serde_json::json!({
		"project": { "name": "test" },
		"vite": { "define": { "DEBUG": "true" } },
		"router": { "key": "val" }
	});

	let transformed = loader::prepare_ts_config(input);
	let config: SeamConfig = serde_json::from_value(transformed).unwrap();

	assert_eq!(config.vite.unwrap()["define"]["DEBUG"], "true");
	assert_eq!(config.router.unwrap()["key"], "val");
}

// -- find_config_in_dir priority --

#[test]
fn find_config_priority_ts_over_mjs_over_toml() {
	let tmp = std::env::temp_dir().join("seam-test-config-priority");
	let _ = std::fs::remove_dir_all(&tmp);
	std::fs::create_dir_all(&tmp).unwrap();

	// Only toml
	std::fs::write(tmp.join("seam.toml"), "[project]\nname = \"a\"").unwrap();
	assert_eq!(find_config_in_dir(&tmp).unwrap().file_name().unwrap(), "seam.toml");

	// Add mjs -- should win over toml
	std::fs::write(tmp.join("seam.config.mjs"), "export default { project: { name: 'a' } }").unwrap();
	assert_eq!(find_config_in_dir(&tmp).unwrap().file_name().unwrap(), "seam.config.mjs");

	// Add ts -- should win over both
	std::fs::write(tmp.join("seam.config.ts"), "export default { project: { name: 'a' } }").unwrap();
	assert_eq!(find_config_in_dir(&tmp).unwrap().file_name().unwrap(), "seam.config.ts");

	let _ = std::fs::remove_dir_all(&tmp);
}

#[test]
fn find_config_in_dir_empty() {
	let tmp = std::env::temp_dir().join("seam-test-config-empty");
	let _ = std::fs::remove_dir_all(&tmp);
	std::fs::create_dir_all(&tmp).unwrap();

	assert!(find_config_in_dir(&tmp).is_none());

	let _ = std::fs::remove_dir_all(&tmp);
}

// -- Error cases --

#[test]
fn no_config_found_error_message() {
	let tmp = std::env::temp_dir().join("seam-test-no-config-msg");
	let _ = std::fs::remove_dir_all(&tmp);
	std::fs::create_dir_all(&tmp).unwrap();

	let err = find_seam_config(&tmp).unwrap_err();
	let msg = err.to_string();
	assert!(msg.contains("seam.config.ts"));
	assert!(msg.contains("seam.config.mjs"));
	assert!(msg.contains("seam.toml"));

	let _ = std::fs::remove_dir_all(&tmp);
}

#[test]
fn invalid_json_from_ts_config() {
	let input: serde_json::Value = serde_json::json!({
		"project": { "name": 123 }  // name should be string
	});

	let transformed = loader::prepare_ts_config(input);
	let result: Result<SeamConfig, _> = serde_json::from_value(transformed);
	assert!(result.is_err());
}

#[test]
fn toml_fallback_shows_legacy_message() {
	let tmp = std::env::temp_dir().join("seam-test-toml-legacy");
	let _ = std::fs::remove_dir_all(&tmp);
	std::fs::create_dir_all(&tmp).unwrap();

	std::fs::write(tmp.join("seam.toml"), "[project]\nname = \"test\"").unwrap();

	// Should succeed loading (legacy message is printed to stdout, we just verify parsing works)
	let config = load_seam_config(&tmp.join("seam.toml")).unwrap();
	assert_eq!(config.project_name(), "test");

	let _ = std::fs::remove_dir_all(&tmp);
}

// -- TS config subprocess integration (requires bun/node) --

#[test]
fn load_ts_config_via_subprocess() {
	let tmp = std::env::temp_dir().join("seam-test-ts-subprocess");
	let _ = std::fs::remove_dir_all(&tmp);
	std::fs::create_dir_all(&tmp).unwrap();

	std::fs::write(
		tmp.join("seam.config.mjs"),
		r#"export default {
  project: { name: "from-mjs" },
  backend: { devCommand: "bun run dev", port: 4567 },
  build: { pagesDir: "src/pages", outDir: ".seam/output" }
}"#,
	)
	.unwrap();

	let config = load_seam_config(&tmp.join("seam.config.mjs")).unwrap();
	assert_eq!(config.project_name(), "from-mjs");
	assert_eq!(config.backend.dev_command.as_deref(), Some("bun run dev"));
	assert_eq!(config.backend.port, 4567);
	assert_eq!(config.build.pages_dir.as_deref(), Some("src/pages"));

	let _ = std::fs::remove_dir_all(&tmp);
}

// -- Workspace with mixed formats --

#[test]
fn workspace_mixed_formats() {
	use std::io::Write;

	let tmp = std::env::temp_dir().join("seam-test-ws-mixed");
	let _ = std::fs::remove_dir_all(&tmp);
	std::fs::create_dir_all(tmp.join("backends/ts-hono")).unwrap();

	// Member uses seam.toml (legacy)
	let mut f = std::fs::File::create(tmp.join("backends/ts-hono/seam.toml")).unwrap();
	writeln!(
		f,
		r#"[project]
name = "ignored"

[backend]
lang = "typescript"
port = 4000

[build]
router_file = "src/router.ts"
"#
	)
	.unwrap();

	// Root uses seam.config.mjs (but we test workspace validation only, not loading)
	// For validation test, we need a parseable root config
	let root: SeamConfig = toml::from_str(
		r#"
[project]
name = "test-ws"

[build]
routes = "routes.ts"
bundler_command = "vite build"
bundler_manifest = "dist/manifest.json"

[workspace]
members = ["backends/ts-hono"]
"#,
	)
	.unwrap();

	// Validate should succeed with member having seam.toml
	validate_workspace(&root, &tmp).unwrap();

	let _ = std::fs::remove_dir_all(&tmp);
}
