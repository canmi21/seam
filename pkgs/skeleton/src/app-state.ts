/**
 * Kit's `$app/state`, as a render is given it.
 *
 * Kit's plugin provides the module and the compiler has no plugin, so a component that imports it
 * is pointed here by the render (`renderRewritten()`). It is Kit's server module in shape: `page` is
 * read out of the component context under `__request__`, where Kit's `render_response` puts the one
 * object it builds per request, and the checks put the same when they render a reference. The walk
 * has already bound every read of `page` to the root's prop of that name (`stateImports()` in
 * `ast`), so a render only reaches this through an import something else kept alive, and a value
 * read here would be a bug in the walk rather than a value: it says so.
 */
import { pathToFileURL } from 'node:url';
import { svelteServer } from './render.ts';

// The server's own `svelte`, named by its file rather than resolved by condition: under a host that
// resolves `svelte` to the client build, `getContext` would find no component to run in.
const { getContext } = (await import(
	pathToFileURL(svelteServer()).href
)) as typeof import('svelte');

type Page = Record<string, unknown>;

function context(name: string): Page {
	const found = getContext<{ page?: Page } | undefined>('__request__');
	if (found?.page === undefined) {
		throw new Error(
			`\`page.${name}\` was read during a render that was given no request. A component reads ` +
				'`page` from `$app/state` as a prop of the root, which the walk binds; reaching this ' +
				'module for its value means a read the walk did not see. See spec/framework.md',
		);
	}
	return found.page;
}

export const page = {
	get data() {
		return context('data')['data'];
	},
	get error() {
		return context('error')['error'];
	},
	get form() {
		return context('form')['form'];
	},
	get params() {
		return context('params')['params'];
	},
	get route() {
		return context('route')['route'];
	},
	get state() {
		return context('state')['state'];
	},
	get status() {
		return context('status')['status'];
	},
	get url() {
		return context('url')['url'];
	},
};

export const navigating = {
	from: null,
	to: null,
	type: null,
	willUnload: null,
	delta: null,
	complete: null,
};

export const updated = {
	get current() {
		return false;
	},
	check: (): never => {
		throw new Error('Can only call updated.check() in the browser');
	},
};
