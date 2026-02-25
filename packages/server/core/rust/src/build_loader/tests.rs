/* packages/server/core/rust/src/build_loader/tests.rs */

use std::collections::HashMap;

use super::loader::{convert_route_path, load_build_output, parse_loaders};
use super::types::ParamConfig;

#[test]
fn convert_route_simple() {
  assert_eq!(convert_route_path("/"), "/");
  assert_eq!(convert_route_path("/about"), "/about");
}

#[test]
fn convert_route_with_param() {
  assert_eq!(convert_route_path("/user/:id"), "/user/{id}");
  assert_eq!(convert_route_path("/dashboard/:username"), "/dashboard/{username}");
}

#[test]
fn convert_route_multiple_params() {
  assert_eq!(convert_route_path("/user/:id/post/:slug"), "/user/{id}/post/{slug}");
}

#[test]
fn parse_loaders_empty() {
  let loaders = serde_json::json!({});
  assert!(parse_loaders(&loaders).is_empty());
}

#[test]
fn parse_loaders_null() {
  let loaders = serde_json::Value::Null;
  assert!(parse_loaders(&loaders).is_empty());
}

#[test]
fn parse_loaders_with_params() {
  let loaders = serde_json::json!({
    "user": {
      "procedure": "getUser",
      "params": {
        "username": { "from": "route", "type": "string" }
      }
    }
  });
  let result = parse_loaders(&loaders);
  assert_eq!(result.len(), 1);
  assert_eq!(result[0].data_key, "user");
  assert_eq!(result[0].procedure, "getUser");
}

#[test]
fn build_input_fn_route_param() {
  let mut params = HashMap::new();
  params.insert(
    "username".to_string(),
    ParamConfig { from: "route".to_string(), param_type: "string".to_string() },
  );
  let input_fn = super::loader::build_input_fn(&params);

  let mut route_params = HashMap::new();
  route_params.insert("username".to_string(), "octocat".to_string());

  let result = input_fn(&route_params);
  assert_eq!(result["username"], "octocat");
}

#[test]
fn build_input_fn_numeric_param() {
  let mut params = HashMap::new();
  params.insert(
    "id".to_string(),
    ParamConfig { from: "route".to_string(), param_type: "uint32".to_string() },
  );
  let input_fn = super::loader::build_input_fn(&params);

  let mut route_params = HashMap::new();
  route_params.insert("id".to_string(), "42".to_string());

  let result = input_fn(&route_params);
  assert_eq!(result["id"], 42);
}

#[test]
fn build_input_fn_missing_param() {
  let mut params = HashMap::new();
  params.insert(
    "username".to_string(),
    ParamConfig { from: "route".to_string(), param_type: "string".to_string() },
  );
  let input_fn = super::loader::build_input_fn(&params);

  let route_params = HashMap::new(); // empty
  let result = input_fn(&route_params);
  assert_eq!(result["username"], "");
}

#[test]
fn resolve_layout_simple() {
  let mut layouts = HashMap::new();
  layouts
    .insert("root".to_string(), ("<html><body><!--seam:outlet--></body></html>".to_string(), None));

  let result = super::loader::resolve_layout_chain("root", "<div>page content</div>", &layouts);
  assert_eq!(result, "<html><body><div>page content</div></body></html>");
}

#[test]
fn resolve_layout_nested() {
  let mut layouts = HashMap::new();
  layouts.insert("root".to_string(), ("<html><!--seam:outlet--></html>".to_string(), None));
  layouts.insert(
    "dashboard".to_string(),
    ("<nav>nav</nav><!--seam:outlet-->".to_string(), Some("root".to_string())),
  );

  let result = super::loader::resolve_layout_chain("dashboard", "<div>page</div>", &layouts);
  assert_eq!(result, "<html><nav>nav</nav><div>page</div></html>");
}

#[test]
fn load_build_output_from_disk() {
  let dir = std::env::temp_dir().join("seam-test-build-loader");
  let _ = std::fs::remove_dir_all(&dir);
  std::fs::create_dir_all(dir.join("templates")).unwrap();

  // Write a layout template
  std::fs::write(
    dir.join("templates/root.html"),
    "<!DOCTYPE html><html><body><!--seam:outlet--></body></html>",
  )
  .unwrap();

  // Write a page template
  std::fs::write(dir.join("templates/index.html"), "<h1><!--seam:title--></h1>").unwrap();

  // Write route-manifest.json
  let manifest = serde_json::json!({
    "layouts": {
      "root": {
        "template": "templates/root.html",
        "loaders": {
          "session": {
            "procedure": "getSession",
            "params": {}
          }
        }
      }
    },
    "routes": {
      "/": {
        "template": "templates/index.html",
        "layout": "root",
        "loaders": {
          "page": {
            "procedure": "getHomeData",
            "params": {}
          }
        }
      }
    }
  });
  std::fs::write(dir.join("route-manifest.json"), serde_json::to_string_pretty(&manifest).unwrap())
    .unwrap();

  let pages = load_build_output(dir.to_str().unwrap()).unwrap();
  assert_eq!(pages.len(), 1);
  assert_eq!(pages[0].route, "/");
  assert!(pages[0].template.contains("<h1><!--seam:title--></h1>"));
  assert!(pages[0].template.contains("<!DOCTYPE html>"));
  // Should have 2 loaders: session from layout + page from route
  assert_eq!(pages[0].loaders.len(), 2);
  assert_eq!(pages[0].loaders[0].data_key, "session");
  assert_eq!(pages[0].loaders[0].procedure, "getSession");
  assert_eq!(pages[0].loaders[1].data_key, "page");
  assert_eq!(pages[0].loaders[1].procedure, "getHomeData");

  let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn load_build_output_with_route_params() {
  let dir = std::env::temp_dir().join("seam-test-build-loader-params");
  let _ = std::fs::remove_dir_all(&dir);
  std::fs::create_dir_all(dir.join("templates")).unwrap();

  std::fs::write(
    dir.join("templates/dashboard-username.html"),
    "<div><!--seam:user.login--></div>",
  )
  .unwrap();

  let manifest = serde_json::json!({
    "routes": {
      "/dashboard/:username": {
        "template": "templates/dashboard-username.html",
        "loaders": {
          "user": {
            "procedure": "getUser",
            "params": {
              "username": { "from": "route", "type": "string" }
            }
          }
        }
      }
    }
  });
  std::fs::write(dir.join("route-manifest.json"), serde_json::to_string_pretty(&manifest).unwrap())
    .unwrap();

  let pages = load_build_output(dir.to_str().unwrap()).unwrap();
  assert_eq!(pages.len(), 1);
  assert_eq!(pages[0].route, "/dashboard/{username}");
  assert_eq!(pages[0].loaders[0].procedure, "getUser");

  // Test the input_fn
  let mut params = HashMap::new();
  params.insert("username".to_string(), "octocat".to_string());
  let input = (pages[0].loaders[0].input_fn)(&params);
  assert_eq!(input["username"], "octocat");

  let _ = std::fs::remove_dir_all(&dir);
}
