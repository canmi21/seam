/* packages/server/core/rust/src/build_loader.rs */

// Load page definitions from seam build output on disk.
// Reads route-manifest.json, loads templates, constructs PageDef with loaders.

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use serde::Deserialize;

use crate::page::{LoaderDef, PageDef};

#[derive(Deserialize)]
struct RouteManifest {
  #[serde(default)]
  layouts: HashMap<String, LayoutEntry>,
  routes: HashMap<String, RouteEntry>,
  #[serde(default)]
  data_id: Option<String>,
}

#[derive(Deserialize)]
struct LayoutEntry {
  template: Option<String>,
  #[serde(default)]
  loaders: serde_json::Value,
  #[serde(default)]
  parent: Option<String>,
}

#[derive(Deserialize)]
struct RouteEntry {
  template: Option<String>,
  #[serde(default)]
  layout: Option<String>,
  #[serde(default)]
  loaders: serde_json::Value,
  #[serde(default)]
  head_meta: Option<String>,
}

#[derive(Deserialize)]
struct LoaderConfig {
  procedure: String,
  #[serde(default)]
  params: HashMap<String, ParamConfig>,
}

#[derive(Deserialize)]
struct ParamConfig {
  from: String,
  #[serde(rename = "type", default = "default_type")]
  param_type: String,
}

fn default_type() -> String {
  "string".to_string()
}

/// Build a LoaderInputFn closure from the loader config's param mappings.
/// For params with `from: "route"`, extracts the value from route params.
fn build_input_fn(params: &HashMap<String, ParamConfig>) -> crate::page::LoaderInputFn {
  let params: Vec<(String, String, String)> = params
    .iter()
    .map(|(key, cfg)| (key.clone(), cfg.from.clone(), cfg.param_type.clone()))
    .collect();

  Arc::new(move |route_params: &HashMap<String, String>| {
    let mut obj = serde_json::Map::new();
    for (key, from, param_type) in &params {
      let value = match from.as_str() {
        "route" => {
          let raw = route_params.get(key).cloned().unwrap_or_default();
          match param_type.as_str() {
            "uint32" | "int32" | "number" => {
              if let Ok(n) = raw.parse::<i64>() {
                serde_json::Value::Number(serde_json::Number::from(n))
              } else {
                serde_json::Value::String(raw)
              }
            }
            _ => serde_json::Value::String(raw),
          }
        }
        _ => serde_json::Value::Null,
      };
      obj.insert(key.clone(), value);
    }
    serde_json::Value::Object(obj)
  })
}

/// Parse loaders JSON object into Vec<LoaderDef>.
fn parse_loaders(loaders: &serde_json::Value) -> Vec<LoaderDef> {
  let Some(obj) = loaders.as_object() else {
    return Vec::new();
  };

  obj
    .iter()
    .filter_map(|(data_key, loader_val)| {
      let config: LoaderConfig = serde_json::from_value(loader_val.clone()).ok()?;
      Some(LoaderDef {
        data_key: data_key.clone(),
        procedure: config.procedure,
        input_fn: build_input_fn(&config.params),
      })
    })
    .collect()
}

/// Resolve a layout chain: walk from child to root, collecting templates.
/// Returns the full document template with <!--seam:outlet--> replaced by page content.
fn resolve_layout_chain(
  layout_id: &str,
  page_template: &str,
  layouts: &HashMap<String, (String, Option<String>)>,
) -> String {
  let mut result = page_template.to_string();
  let mut current = Some(layout_id.to_string());

  while let Some(id) = current {
    if let Some((tmpl, parent)) = layouts.get(&id) {
      result = tmpl.replace("<!--seam:outlet-->", &result);
      current = parent.clone();
    } else {
      break;
    }
  }

  result
}

/// Load page definitions from seam build output on disk.
/// Reads route-manifest.json, loads templates, constructs PageDef with loaders.
pub fn load_build_output(dir: &str) -> Result<Vec<PageDef>, Box<dyn std::error::Error>> {
  let base = Path::new(dir);
  let manifest_path = base.join("route-manifest.json");
  let content = std::fs::read_to_string(&manifest_path)?;
  let manifest: RouteManifest = serde_json::from_str(&content)?;

  // Load layout templates
  let mut layout_templates: HashMap<String, (String, Option<String>)> = HashMap::new();
  for (id, entry) in &manifest.layouts {
    if let Some(ref tmpl_path) = entry.template {
      let full_path = base.join(tmpl_path);
      let tmpl = std::fs::read_to_string(&full_path)?;
      layout_templates.insert(id.clone(), (tmpl, entry.parent.clone()));
    }
  }

  let mut pages = Vec::new();

  for (route_path, entry) in &manifest.routes {
    // Load page template
    let page_template = if let Some(ref tmpl_path) = entry.template {
      let full_path = base.join(tmpl_path);
      std::fs::read_to_string(&full_path)?
    } else {
      continue;
    };

    // Resolve layout chain if this page has a layout
    let template = if let Some(ref layout_id) = entry.layout {
      let mut full = resolve_layout_chain(layout_id, &page_template, &layout_templates);
      // Inject head_meta into layout's <head> if present
      if let Some(ref meta) = entry.head_meta {
        full = full.replace("</head>", &format!("{meta}</head>"));
      }
      full
    } else {
      page_template
    };

    // Convert route path from client format (/:param) to Axum format (/{param})
    let axum_route = convert_route_path(route_path);

    // Parse loaders: combine layout loaders + route loaders
    let mut all_loaders = Vec::new();
    if let Some(ref layout_id) = entry.layout {
      // Collect loaders from the layout chain
      let mut chain = Some(layout_id.clone());
      while let Some(id) = chain {
        if let Some(layout_entry) = manifest.layouts.get(&id) {
          all_loaders.extend(parse_loaders(&layout_entry.loaders));
          chain = layout_entry.parent.clone();
        } else {
          break;
        }
      }
    }
    all_loaders.extend(parse_loaders(&entry.loaders));

    pages.push(PageDef { route: axum_route, template, loaders: all_loaders });
  }

  Ok(pages)
}

/// Convert client route path to Axum format: /:param -> /{param}
fn convert_route_path(path: &str) -> String {
  path
    .split('/')
    .map(|seg| {
      if let Some(param) = seg.strip_prefix(':') {
        format!("{{{param}}}")
      } else {
        seg.to_string()
      }
    })
    .collect::<Vec<_>>()
    .join("/")
}

#[cfg(test)]
mod tests {
  use super::*;

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
    let input_fn = build_input_fn(&params);

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
    let input_fn = build_input_fn(&params);

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
    let input_fn = build_input_fn(&params);

    let route_params = HashMap::new(); // empty
    let result = input_fn(&route_params);
    assert_eq!(result["username"], "");
  }

  #[test]
  fn resolve_layout_simple() {
    let mut layouts = HashMap::new();
    layouts.insert(
      "root".to_string(),
      ("<html><body><!--seam:outlet--></body></html>".to_string(), None),
    );

    let result = resolve_layout_chain("root", "<div>page content</div>", &layouts);
    assert_eq!(result, "<html><body><div>page content</div></body></html>");
  }

  #[test]
  fn resolve_layout_nested() {
    let mut layouts = HashMap::new();
    layouts.insert(
      "root".to_string(),
      ("<html><!--seam:outlet--></html>".to_string(), None),
    );
    layouts.insert(
      "dashboard".to_string(),
      ("<nav>nav</nav><!--seam:outlet-->".to_string(), Some("root".to_string())),
    );

    let result = resolve_layout_chain("dashboard", "<div>page</div>", &layouts);
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
}
