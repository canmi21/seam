/* src/server/engine/rust/src/lib.rs */

pub mod build;
pub mod escape;
pub mod page;
pub mod render;

// Public API re-exports
pub use build::{PageDefOutput, parse_build_output, parse_i18n_config, parse_rpc_hash_map};
pub use escape::ascii_escape_json;
pub use page::{
  I18nOpts, LayoutChainEntry, PageAssets, PageConfig, build_seam_data, filter_i18n_messages,
  flatten_for_slots, generate_prefetch_tags, generate_script_tags, generate_style_tags, i18n_query,
  inject_data_script, inject_head_meta, inject_html_lang, replace_asset_slots, strip_asset_slots,
};
pub use render::render_page;
