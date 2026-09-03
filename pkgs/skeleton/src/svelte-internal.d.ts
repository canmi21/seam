/**
 * The Svelte internals this package reaches for, declared because they ship no types.
 *
 * `html` is the helper Svelte's own server output calls for `{@html}`, and calling it is how this
 * package measures which build of Svelte was loaded rather than reasoning about it.
 *
 * `attr_class` is what a `class:` directive compiles to. It is called rather than reproduced, so
 * the joining, the removal of a falsy directive's name from the class it was given, the escaping
 * and the empty result that writes no attribute at all are Svelte's answers. See `skeleton.ts` and
 * spec/refusals.md.
 */
declare module 'svelte/internal/server' {
	export function html(value: unknown): string;
	export function attr_class(
		value: unknown,
		hash?: string,
		directives?: Record<string, boolean>,
	): string;
}
