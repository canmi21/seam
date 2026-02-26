/* examples/standalone/server-rust/src/pages/mod.rs */

use std::sync::Arc;

use seam_server::page::{LoaderDef, PageDef};

pub fn user_page() -> PageDef {
  PageDef {
    route: "/user/{id}".to_string(),
    template: include_str!("../../../templates/user.html").to_string(),
    locale_templates: None,
    loaders: vec![LoaderDef {
      data_key: "user".to_string(),
      procedure: "getUser".to_string(),
      input_fn: Arc::new(|params| {
        let id: u32 = params.get("id").and_then(|v| v.parse().ok()).unwrap_or(0);
        serde_json::json!({ "id": id })
      }),
    }],
    data_id: "__SEAM_DATA__".to_string(),
    layout_chain: vec![],
    page_loader_keys: vec!["user".to_string()],
    i18n_keys: Vec::new(),
  }
}
