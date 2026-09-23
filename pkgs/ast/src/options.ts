/**
 * The compile options a project sets in `svelte.config.js` that change what a component compiles
 * to, handed to every compile this pipeline makes the way `vite-plugin-svelte` hands them to Svelte.
 *
 * Set once per compile by the one package that reads the configuration, the way the aliases are;
 * unset, Svelte decides for itself. Only `runes` is here: a project that sets it compiles every
 * component in that mode, where one that does not has each component's mode read off its scripts,
 * and the two write different bytes for the same markup. See spec/pipeline.md.
 */
export interface ProjectOptions {
	runes?: boolean;
}

let options: ProjectOptions = {};

export function configureProjectOptions(given: ProjectOptions): void {
	options = given.runes === undefined ? {} : { runes: given.runes };
}

/** What is configured, to be spread into a compile's options. */
export function projectOptions(): ProjectOptions {
	return options;
}
