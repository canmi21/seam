// A route end to end: its root generated from `src/routes` the way Kit generates it, compiled as
// the entry, and the artifact injected with the payload Kit's shape gives it -- `data_0` .. `data_n`,
// `params`, `form` -- against Svelte's own render of the same root with the same props. This is
// the layout chain as one walk, which is what makes a page's ancestors' context reach it.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { carriedBy, carry } from 'carry';
import { compile as compileDerivations } from 'derive';
import { inject } from 'injector';
import { lower } from 'lowering';
import { entries } from 'routes';
import { appStateModule as appState, expressionsOf, helpers } from 'skeleton';
import { joined, type Structure } from './variants.ts';
import { structures } from './compile.ts';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '../.build-entries');
// The layout imports `setContext` from `svelte`, and this check runs under a config that resolves
// `svelte` to the client build; the server's own is named by its file, as the render does.
const server = resolve(
	dirname(createRequire(import.meta.url).resolve('svelte/package.json')),
	'src/index-server.js',
);

const files: Record<string, string> = {
	// A layout that sets context for the page, which is the shape press's `QueryClient` has: a
	// value the script makes, not one the request sends, and the page reads it out of the context.
	'src/routes/+layout.svelte':
		"<script>import { setContext } from 'svelte'; import Provider from '../lib/provider.svelte'; let { children, data } = $props(); setContext('site', { name: 'Site' });</script>" +
		'<header>{data.site}</header><Provider><main>{@render children()}</main></Provider>',
	// A provider the layout wraps the page in, the shape press's query client has: the page is
	// handed through two components, the layout's `children` rendered inside the provider's.
	'src/lib/provider.svelte':
		'<script>let { children } = $props();</script><div class="provider">{@render children()}</div>',
	'src/routes/+page.svelte':
		"<script>import { getContext } from 'svelte'; let { data } = $props(); const site = getContext('site');</script>" +
		'<h1>{site.name}: {data.title}</h1>{#each data.items as item}<li>{item}</li>{/each}',
	'src/routes/blog/+layout.svelte':
		'<script>let { children } = $props();</script><section class="blog">{@render children()}</section>',
	'src/routes/blog/[slug]/+page.svelte':
		'<script>let { data, params } = $props();</script><article>{params.slug}: {data.body}</article>{#if data.draft}<em>draft</em>{/if}',
	// The request's `page`, read from `$app/state` two levels below the root that holds it, in
	// markup and through a `$derived`; and the two constants of the module beside it.
	'src/routes/about/+page.svelte':
		"<script>import { page, navigating, updated } from '$app/state'; import Where from '$lib/where.svelte'; const here = $derived(page.url.pathname);</script>" +
		'<a href={here}>{page.url.pathname}</a><Where />{navigating.from ?? "still"}{updated.current}',
	'src/lib/where.svelte':
		"<script>import { page as current } from '$app/state';</script><code>{current.route.id} {current.status} {current.data.title}</code>",
};

/** The `page` Kit's `render_response` builds for a request, in the shape `$app/state` reads. */
function pageOf(id: string, url: string, params: Record<string, string>, data: unknown) {
	return {
		error: null,
		params,
		route: { id },
		status: 200,
		url: new URL(url),
		data,
		form: null,
		state: {},
	};
}

function compiled(dir: string): void {
	for (const name of readdirSync(dir, { withFileTypes: true })) {
		const at = join(dir, name.name);
		if (name.isDirectory()) {
			compiled(at);
			continue;
		}
		if (!name.name.endsWith('.svelte')) continue;
		const code = compile(readFileSync(at, 'utf8'), {
			generate: 'server',
			name: 'C',
			filename: at,
			rootDir: project,
		})
			.js.code.replace(/from '(\.[^']*)\.svelte'/g, "from '$1.js'")
			// `$lib` is Kit's alias, which the compiler resolves itself and Node does not.
			.replace(/from '\$lib\/([^']*)\.svelte'/g, (_, rest: string) => {
				const target = resolve(project, 'src/lib', `${rest}.js`);
				return `from ${JSON.stringify(pathToFileURL(target).href)}`;
			})
			.replace(/from 'svelte'/g, `from ${JSON.stringify(pathToFileURL(server).href)}`)
			// Kit's plugin provides `$app/state`; the reference render is given what the compiler's
			// render is given, which reads `page` out of the context the way Kit's module does.
			.replace(/from '\$app\/state'/g, `from ${JSON.stringify(pathToFileURL(appState).href)}`);
		writeFileSync(at.replace(/\.svelte$/, '.js'), code);
	}
}

beforeAll(() => {
	rmSync(project, { recursive: true, force: true });
	for (const [file, source] of Object.entries(files)) {
		mkdirSync(dirname(resolve(project, file)), { recursive: true });
		writeFileSync(resolve(project, file), source);
	}
});
afterAll(() => rmSync(project, { recursive: true, force: true }));

describe('a route is compiled from its generated root', () => {
	it.each([
		[
			'/',
			[
				{ site: 'S', title: 'Home', items: ['a', 'b'] },
				{ site: '<', title: '', items: [] },
			],
			{},
		],
		[
			'/blog/[slug]',
			[
				{ body: 'text', draft: true },
				{ body: '&', draft: false },
			],
			{ slug: 'x' },
		],
		['/about', [{ title: 'About' }, { title: '<us>' }], {}],
	])('%s', async (id, payloads, params) => {
		const found = await entries(project);
		const entry = found.find((one) => one.path === id);
		if (entry === undefined) throw new Error(`no root for ${id}`);
		const runs = await structures({ path: entry.path, component: entry.component }, project);
		const lowered = lower(runs.map((one) => [id, JSON.stringify(one.skeleton)] as const));
		const structure = joined(
			id,
			runs.map((one, at) => ({ ...one, compiled: lowered[at] as unknown as Structure })),
		);
		const carried = await carry(
			resolve(project, entry.component),
			new Map([
				...carriedBy(
					project,
					runs.flatMap((one) => expressionsOf(one.skeleton)),
				),
				['*', helpers(runs[0]!.skeleton)],
			]),
		);
		const derive = compileDerivations(structure.derivations, carried);

		compiled(project);
		const mod = (await import(
			pathToFileURL(resolve(project, entry.component.replace(/\.svelte$/, '.js'))).href
		)) as { default: never };
		for (const page of payloads) {
			// Kit's data down the branch: each node's own load merged onto its parents'.
			const site = { site: 'site' };
			const props: Record<string, unknown> = { form: null };
			entry.page.branch.forEach((_, at) => {
				props[`data_${String(at)}`] = at === 0 ? site : { ...site, ...page };
			});
			props['page'] = pageOf(id, `http://localhost${id}`, params, { ...site, ...page });
			const ours = inject(structure.ir, derive(props));
			// Kit hands the root `page` as a prop and the same object to `$app/state` through the
			// context, under `__request__`; both are given here as `render_response` gives them.
			const theirs = render(mod.default, {
				props: props as never,
				context: new Map([['__request__', { page: props['page'] }]]),
			});
			expect(ours.body).toBe(theirs.body);
			expect(ours.head).toBe(theirs.head);
		}
	});
});
