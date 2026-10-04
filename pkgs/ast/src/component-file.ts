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
