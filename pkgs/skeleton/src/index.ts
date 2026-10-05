import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { forgetDynamicSources } from './dynamic.ts';
import { forgetDeclaredNames } from './hydratable.ts';
export { expressionsOf, helpers } from './helpers.ts';
export { skeleton, type Skeleton, type Hole, Undecided } from './skeleton.ts';
export {
	configureLoadedComponents,
	configureUnnamedComponents,
	type Loaded,
} from './components.ts';

/**
 * Where the render's `$app/state` sits, for a check that renders a reference with the same
 * module: Kit's plugin provides the real one, and nothing outside a Vite build has it.
 */
export {
	configureRender,
	forgetStaging,
	rememberedCodegen,
	rememberedStaging,
	type Host,
	unavailable,
} from './render.ts';

/**
 * What the walk remembers of a file by its path rather than by its content, forgotten: for the dev
 * server, which compiles again after a file changes. See spec/build.md, "How the dev server compiles
 * a route".
 */
export function forgetSources(): void {
	forgetDynamicSources();
	forgetDeclaredNames();
}

/** What a compile spent where, printed by the compiler when `SEAM_TIME` is set. */
export { forgetTimings, timed, timedSync, timings } from './timing.ts';

export const appStateModule: string = fileURLToPath(
	new URL(`./app-state${extname(import.meta.url)}`, import.meta.url),
);
