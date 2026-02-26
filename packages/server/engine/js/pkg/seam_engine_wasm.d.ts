/* packages/server/engine/js/pkg/seam_engine_wasm.d.ts */

/* tslint:disable */
/* eslint-disable */

export function ascii_escape_json(json: string): string;

export function i18n_query(
  keys_json: string,
  locale: string,
  default_locale: string,
  messages_json: string,
): string;

export function inject(template: string, data_json: string): string;

export function inject_no_script(template: string, data_json: string): string;

export function parse_build_output(manifest_json: string): string;

export function parse_i18n_config(manifest_json: string): string;

export function parse_rpc_hash_map(hash_map_json: string): string;

export function render_page(
  template: string,
  loader_data_json: string,
  config_json: string,
  i18n_opts_json: string,
): string;
