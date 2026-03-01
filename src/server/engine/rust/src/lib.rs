/* src/server/engine/rust/src/lib.rs */

pub mod build;
pub mod escape;
pub mod page;
pub mod render;

// Public API re-exports
pub use build::{PageDefOutput, parse_build_output, parse_i18n_config, parse_rpc_hash_map};
pub use escape::ascii_escape_json;
pub use page::{
  I18nOpts, LayoutChainEntry, PageConfig, build_seam_data, filter_i18n_messages, flatten_for_slots,
  i18n_query, inject_data_script, inject_head_meta, inject_html_lang,
};
pub use render::render_page;
