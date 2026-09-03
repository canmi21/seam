/**
 * The Vite settings the compiler takes control of, and saying so when it takes one.
 *
 * A compiler that quietly wins an argument with a configuration file has made the file a lie. The
 * set is data rather than a rule buried in merge code, so it can be printed and can be written
 * down in spec/build.md as a contract. SvelteKit's plugin is where the arrangement comes from.
 */
import type { UserConfig } from 'vite';

type Enforced = { [key: string]: true | Enforced };

export const ENFORCED: Enforced = {
	// Where the client half lands. The server half is written beside it by the compiler, and
	// neither is useful without the other.
	build: {
		outDir: true,
		// Read after the build to learn the hashed names, which become the tags a document needs.
		manifest: true,
		// One hydration entry per route, and they are virtual: nothing on disk to point at.
		rollupOptions: { input: true },
	},
	// What component ids, and therefore artifact names and every filename hash, are relative to.
	root: true,
};

/** Every enforced setting the user also set, and to something else. */
function overridden(given: unknown, resolved: unknown, enforced: Enforced, path: string): string[] {
	const out: string[] = [];
	if (given === null || typeof given !== 'object') return out;
	if (resolved === null || typeof resolved !== 'object') return out;

	for (const [key, rule] of Object.entries(enforced)) {
		if (!(key in given)) continue;
		const mine = (given as Record<string, unknown>)[key];
		const theirs = (resolved as Record<string, unknown>)[key];
		if (rule === true) {
			if (mine !== theirs) out.push(path + key);
		} else {
			out.push(...overridden(mine, theirs, rule, `${path}${key}.`));
		}
	}
	return out;
}

export function announce(given: UserConfig, resolved: UserConfig): void {
	const taken = overridden(given, resolved, ENFORCED, '');
	if (taken.length === 0) return;
	console.error(
		`The following Vite config options are set by the compiler:${taken.map((one) => `\n  - ${one}`).join('')}`,
	);
}
