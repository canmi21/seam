/**
 * The compile options a project sets in `svelte.config.js` that change what a component compiles
 * to, handed to every compile this pipeline makes the way `vite-plugin-svelte` hands them to Svelte.
 *
 * Set once per compile by the one package that reads the configuration, the way the aliases are;
 * unset, Svelte decides for itself. Two are here. `runes`: a project that sets it compiles every
 * component in that mode, where one that does not has each component's mode read off its scripts,
 * and the two write different bytes for the same markup. `experimental.async`: a project that sets
 * it compiles `await` in markup and at the top of a script, and its render is awaited. See
 * spec/pipeline.md.
 */
export interface ProjectOptions {
	/**
	 * A boolean, or a function of the file as Svelte's own option is: `({ filename }) => boolean |
	 * undefined`, which `sv create` writes to force runes everywhere but `node_modules`. Svelte calls
	 * it with the filename the compile is given, so each compile here is given the file's real path.
	 */
	runes?: boolean | ((options: { filename: string }) => boolean | undefined);
	/** Svelte's own `experimental.async`, which Svelte 6 makes the only mode. */
	experimental?: { async: true };
}

let options: ProjectOptions = {};

export function configureProjectOptions(given: ProjectOptions): void {
	options = {
		...(given.runes === undefined ? {} : { runes: given.runes }),
		...(given.experimental?.async === true ? { experimental: { async: true } } : {}),
	};
}

/** Whether the project compiles in Svelte's async mode, which is also whether a render is awaited. */
export function projectAsync(): boolean {
	return options.experimental?.async === true;
}

/** The mode the project sets for one file, or undefined where the file's scripts decide. */
export function projectRunes(filename: string): boolean | undefined {
	const given = options.runes;
	return typeof given === 'function' ? given({ filename }) : given;
}

/**
 * How the dev server compiles, where a compile is for it: Svelte's `dev`, and `hmr` as
 * `vite-plugin-svelte` decides it, with `emitCss` beside it because the two together change the
 * source it compiles. Kept apart from the project's options, which every route's compile sets
 * again, since it is a fact about the server rather than about the project. Null for a build. See
 * spec/build.md, "The dev server compiles a route when it is asked for".
 */
export interface Development {
	hmr: boolean;
	emitCss: boolean;
}

let development: Development | null = null;

export function configureDevelopment(given: Development | null): void {
	development = given;
}

/** The dev server's compile options, or null where the compile is a build's. */
export function projectDevelopment(): Development | null {
	return development;
}

/** What is configured, to be spread into a compile's options. */
export function projectOptions(): ProjectOptions & { dev?: true; hmr?: boolean } {
	return development === null ? options : { ...options, dev: true, hmr: development.hmr };
}
