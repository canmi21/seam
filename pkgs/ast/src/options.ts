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
	/**
	 * A boolean, or a function of the file as Svelte's own option is: `({ filename }) => boolean |
	 * undefined`, which `sv create` writes to force runes everywhere but `node_modules`. Svelte calls
	 * it with the filename the compile is given, so each compile here is given the file's real path.
	 */
	runes?: boolean | ((options: { filename: string }) => boolean | undefined);
}

let options: ProjectOptions = {};

export function configureProjectOptions(given: ProjectOptions): void {
	options = given.runes === undefined ? {} : { runes: given.runes };
}

/** The mode the project sets for one file, or undefined where the file's scripts decide. */
export function projectRunes(filename: string): boolean | undefined {
	const given = options.runes;
	return typeof given === 'function' ? given({ filename }) : given;
}

/** What is configured, to be spread into a compile's options. */
export function projectOptions(): ProjectOptions {
	return options;
}
