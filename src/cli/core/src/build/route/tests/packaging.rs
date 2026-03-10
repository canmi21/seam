/* src/cli/core/src/build/route/tests/packaging.rs */

use super::super::manifest::package_static_assets;

#[test]
fn package_static_assets_copies_all_files() {
	let tmp = tempfile::tempdir().unwrap();
	let base = tmp.path();

	// Create dist/ with assets and a .vite/ directory that should be skipped
	let assets_dir = base.join("dist/assets");
	std::fs::create_dir_all(&assets_dir).unwrap();
	std::fs::write(assets_dir.join("main-abc.js"), "// main").unwrap();
	std::fs::write(assets_dir.join("chunk-xyz.js"), "// shared chunk").unwrap();
	std::fs::write(assets_dir.join("routes-def.js"), "// dynamic entry").unwrap();
	std::fs::write(assets_dir.join("main-abc.css"), "body{}").unwrap();

	let vite_dir = base.join("dist/.vite");
	std::fs::create_dir_all(&vite_dir).unwrap();
	std::fs::write(vite_dir.join("manifest.json"), "{}").unwrap();

	let out_dir = base.join("output");
	let count = package_static_assets(base, &out_dir, "dist").unwrap();

	assert_eq!(count, 4);

	let public_assets = out_dir.join("public/assets");
	assert!(public_assets.join("main-abc.js").exists());
	assert!(public_assets.join("chunk-xyz.js").exists());
	assert!(public_assets.join("routes-def.js").exists());
	assert!(public_assets.join("main-abc.css").exists());

	// .vite/ must NOT be copied
	assert!(!out_dir.join("public/.vite").exists());
}

#[test]
fn package_static_assets_handles_flat_layout() {
	let tmp = tempfile::tempdir().unwrap();
	let base = tmp.path();

	// Obfuscated build: files at root level, no assets/ subdir
	let dist = base.join("dist");
	std::fs::create_dir_all(&dist).unwrap();
	std::fs::write(dist.join("abc123.js"), "// js").unwrap();
	std::fs::write(dist.join("def456.css"), "/* css */").unwrap();

	let vite_dir = dist.join(".vite");
	std::fs::create_dir_all(&vite_dir).unwrap();
	std::fs::write(vite_dir.join("manifest.json"), "{}").unwrap();

	let out_dir = base.join("output");
	let count = package_static_assets(base, &out_dir, "dist").unwrap();

	assert_eq!(count, 2);

	let public = out_dir.join("public");
	assert!(public.join("abc123.js").exists());
	assert!(public.join("def456.css").exists());
	assert!(!public.join(".vite").exists());
}

#[test]
fn package_static_assets_missing_dist_returns_zero() {
	let tmp = tempfile::tempdir().unwrap();
	let base = tmp.path();
	let out_dir = base.join("output");

	let count = package_static_assets(base, &out_dir, "dist").unwrap();
	assert_eq!(count, 0);
}
