/**
 * The one Svelte internal this package reaches for, declared because it ships no types.
 *
 * `html` is the helper Svelte's own server output calls for `{@html}`, and calling it is how this
 * package measures which build of Svelte was loaded rather than reasoning about it. See
 * `skeleton.ts` and spec/refusals.md.
 */
declare module 'svelte/internal/server' {
	export function html(value: unknown): string;
}
