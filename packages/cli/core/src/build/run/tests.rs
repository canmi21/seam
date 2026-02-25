/* packages/cli/core/src/build/run/tests.rs */

use super::super::types::read_bundle_manifest;

#[test]
fn read_seam_manifest() {
  let dir = std::env::temp_dir().join("seam-test-manifest");
  std::fs::create_dir_all(&dir).unwrap();
  let path = dir.join("manifest.json");
  std::fs::write(&path, r#"{"js":["assets/main-abc123.js"],"css":["assets/style-xyz789.css"]}"#)
    .unwrap();
  let assets = read_bundle_manifest(&path).unwrap();
  assert_eq!(assets.js, vec!["assets/main-abc123.js"]);
  assert_eq!(assets.css, vec!["assets/style-xyz789.css"]);
  std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn read_seam_manifest_empty() {
  let dir = std::env::temp_dir().join("seam-test-manifest-empty");
  std::fs::create_dir_all(&dir).unwrap();
  let path = dir.join("manifest.json");
  std::fs::write(&path, r#"{"js":[],"css":[]}"#).unwrap();
  let assets = read_bundle_manifest(&path).unwrap();
  assert!(assets.js.is_empty());
  assert!(assets.css.is_empty());
  std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn read_vite_manifest() {
  let dir = std::env::temp_dir().join("seam-test-vite-manifest");
  std::fs::create_dir_all(&dir).unwrap();
  let path = dir.join("manifest.json");
  std::fs::write(
    &path,
    r#"{
      "src/client/main.tsx": {
        "file": "assets/main-abc123.js",
        "css": ["assets/main-def456.css"],
        "isEntry": true,
        "src": "src/client/main.tsx"
      }
    }"#,
  )
  .unwrap();
  let assets = read_bundle_manifest(&path).unwrap();
  assert_eq!(assets.js, vec!["assets/main-abc123.js"]);
  assert_eq!(assets.css, vec!["assets/main-def456.css"]);
  std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn read_vite_manifest_multiple_entries() {
  let dir = std::env::temp_dir().join("seam-test-vite-multi");
  std::fs::create_dir_all(&dir).unwrap();
  let path = dir.join("manifest.json");
  std::fs::write(
    &path,
    r#"{
      "src/client/main.tsx": {
        "file": "assets/main-111.js",
        "css": ["assets/main-222.css"],
        "isEntry": true
      },
      "src/client/vendor.ts": {
        "file": "assets/vendor-333.js",
        "css": [],
        "isEntry": false
      }
    }"#,
  )
  .unwrap();
  let assets = read_bundle_manifest(&path).unwrap();
  assert_eq!(assets.js, vec!["assets/main-111.js"]);
  assert_eq!(assets.css, vec!["assets/main-222.css"]);
  std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn read_seam_manifest_not_confused_with_vite() {
  let dir = std::env::temp_dir().join("seam-test-no-confusion");
  std::fs::create_dir_all(&dir).unwrap();
  let path = dir.join("manifest.json");
  std::fs::write(&path, r#"{"js":["assets/app.js"],"css":["assets/app.css"]}"#).unwrap();
  let assets = read_bundle_manifest(&path).unwrap();
  assert_eq!(assets.js, vec!["assets/app.js"]);
  assert_eq!(assets.css, vec!["assets/app.css"]);
  std::fs::remove_dir_all(&dir).ok();
}
