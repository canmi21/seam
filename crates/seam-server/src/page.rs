use std::collections::HashMap;
use std::sync::Arc;

pub type LoaderInputFn =
    Arc<dyn Fn(&HashMap<String, String>) -> serde_json::Value + Send + Sync>;

pub struct LoaderDef {
    pub data_key: String,
    pub procedure: String,
    pub input_fn: LoaderInputFn,
}

pub struct PageDef {
    /// Axum route syntax, e.g. "/user/{id}"
    pub route: String,
    pub template: String,
    pub loaders: Vec<LoaderDef>,
}
