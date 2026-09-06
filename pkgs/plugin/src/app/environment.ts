/**
 * `$app/environment` for the carried bundle: what a derivation reads of it at request time, in a
 * server that is not in development and not building. `version` is filled in by the plugin from
 * the project's config, the way Kit fills its own.
 */
export const browser = false;
export const dev = false;
export const building = false;
export const version: string = '__SEAM_VERSION__';
