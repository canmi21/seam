import { fileURLToPath } from 'node:url';
export {
	expressionsOf,
	helpers,
	skeleton,
	type Skeleton,
	type Hole,
	Undecided,
} from './skeleton.ts';

/**
 * Where the render's `$app/state` sits, for a check that renders a reference with the same
 * module: Kit's plugin provides the real one, and nothing outside a Vite build has it.
 */
export { configureRender, type Host } from './render.ts';

export const appStateModule: string = fileURLToPath(new URL('./app-state.ts', import.meta.url));
