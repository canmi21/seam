/**
 * Which files are components: the extensions the project's Kit config lists, `.svelte` alone by
 * default. Kit's `options` app adds `.jesuslivesineveryone` and `.svelte.md`, and a page under one
 * of them was read as a module to carry rather than a component to enter. Configured once per
 * compile from the project's config, as the aliases are. See spec/framework.md.
 */
let extensions: readonly string[] = ['.svelte'];

export function configureComponentExtensions(given: readonly string[]): void {
	extensions = given.length > 0 ? [...given] : ['.svelte'];
}

/** Whether `file` -- a path or a specifier -- names a component. */
export function isComponentFile(file: string): boolean {
	return extensions.some((one) => file.endsWith(one));
}

/**
 * A component file's name without its extension: `+page` for `+page.svelte.md`. What a staged copy
 * is named from, which kept `.svelte.md` before and so read to Svelte's Vite plugin as a runes
 * module, compiling the copy's own output again.
 */
export function componentStem(file: string): string {
	const name = file.slice(file.lastIndexOf('/') + 1);
	const extension = extensions.find((one) => name.endsWith(one));
	return extension === undefined ? name : name.slice(0, -extension.length);
}
