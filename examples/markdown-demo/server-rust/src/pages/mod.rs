/* examples/markdown-demo/server-rust/src/pages/mod.rs */

use seam_server::page::{LoaderDef, PageDef};

pub fn article_page() -> PageDef {
	PageDef {
		route: "/".to_string(),
		template: include_str!("../../../templates/article.html").to_string(),
		locale_templates: None,
		loaders: vec![LoaderDef {
			data_key: "article".to_string(),
			procedure: "getArticle".to_string(),
			input_fn: std::sync::Arc::new(|_params| serde_json::json!({})),
		}],
		derives: None,
		data_id: "__data".to_string(),
		layout_chain: vec![],
		page_loader_keys: vec!["article".to_string()],
		i18n_keys: Vec::new(),
		projections: None,
		prerender: false,
		static_dir: None,
	}
}
