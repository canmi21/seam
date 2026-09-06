// The generated root against SvelteKit's own: both rendered by Svelte's server with the props each
// takes, and compared byte for byte. Kit's root is the one `write_root` writes for the same
// project, rendered with the constructors, stores and page Kit's `render_response` hands it; ours
// takes the route's components as imports and its data as props. The comparison is what stands
// between this file and a drift in Kit's template.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
import { readable, writable } from 'svelte/store';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import create_manifest_data from '@sveltejs/kit/src/core/sync/create_manifest_data/index.js';
import { write_root } from '@sveltejs/kit/src/core/sync/write_root.js';
import { aliases, configured, entries, rootFile, routes } from './index.ts';

// Inside the package rather than under the system's temporary directory: the compiled components
// import `svelte` by its bare name, which Node resolves from here and from nowhere else, and one
// copy of Svelte is what lets `setContext` in Kit's root find the component it runs in.
const project = resolve(dirname(fileURLToPath(import.meta.url)), '../.build-routes');
const server = resolve(
	dirname(createRequire(import.meta.url).resolve('svelte/package.json')),
	'src/index-server.js',
);

const files: Record<string, string> = {
	'src/routes/+layout.svelte':
		'<script>let { children, data } = $props();</script><header>{data?.site ?? "site"}</header>{@render children()}',
	'src/routes/+page.svelte': '<script>let { data } = $props();</script><h1>{data.title}</h1>',
	'src/routes/blog/+layout.svelte':
		'<script>let { children } = $props();</script><section class="blog">{@render children()}</section>',
	'src/routes/blog/[slug]/+page.svelte':
		'<script>let { data, params } = $props();</script><article>{params.slug}: {data.body}</article>',
	'src/routes/(marketing)/about/+page.svelte': '<p>about</p>',
	'src/routes/api/+server.js': 'export function GET() { return new Response("x"); }',
	// The project's own configuration, read as Kit reads it: an alias with and without `/*`, and a
	// file path the author moved, all relative to the project rather than to whoever compiles it.
	'svelte.config.js':
		"export default { kit: { alias: { $parts: 'src/parts', '$data/*': 'data/*' }, files: { assets: 'public' } } };",
};

/** Compiles every `.svelte` under a directory to a `.js` beside it that Node can import. */
function compiled(dir: string): void {
	for (const name of readdirSync(dir, { withFileTypes: true })) {
		const at = join(dir, name.name);
		if (name.isDirectory()) {
			compiled(at);
			continue;
		}
		if (!name.name.endsWith('.svelte')) continue;
		let code = compile(readFileSync(at, 'utf8'), {
			generate: 'server',
			name: 'C',
			filename: at,
			rootDir: project,
		}).js.code;
		code = code
			.replace(/from '\$app\/env'/g, "from 'data:text/javascript,export const browser = false;'")
			// Kit's root imports `setContext` from `svelte`, and the check runs under a config that
			// resolves `svelte` to the client build; the server's own is named by its file.
			.replace(/from 'svelte'/g, `from ${JSON.stringify(pathToFileURL(server).href)}`)
			.replace(/from '(\.[^']*)\.svelte'/g, "from '$1.js'");
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

describe('the routes are read the way Kit reads them', () => {
	it('finds every page, its branch and the depth', async () => {
		const found = await routes(project);
		// Two layouts down the blog route, and Kit's `filter(Boolean)` not counting node 0.
		expect(found.depth).toBe(2);
		expect(found.pages.map((one) => one.id).toSorted()).toEqual([
			'/',
			'/(marketing)/about',
			'/blog/[slug]',
		]);
		const blog = found.pages.find((one) => one.id === '/blog/[slug]');
		expect(blog?.params).toEqual(['slug']);
		expect(blog?.branch).toEqual([
			'src/routes/+layout.svelte',
			'src/routes/blog/+layout.svelte',
			'src/routes/blog/[slug]/+page.svelte',
		]);
		expect(found.pages.find((one) => one.id === '/')?.branch).toEqual([
			'src/routes/+layout.svelte',
			'src/routes/+page.svelte',
		]);
	});
});

describe("the configuration is the project's, resolved against it", () => {
	it('reads svelte.config.js and spells every path absolute', async () => {
		const config = await configured(project);
		expect(config.kit.files.assets).toBe(resolve(project, 'public'));
		expect(config.kit.files.routes).toBe(resolve(project, 'src/routes'));
		expect(await aliases(project)).toEqual({
			$lib: resolve(project, 'src/lib'),
			$parts: resolve(project, 'src/parts'),
			$data: resolve(project, 'data'),
		});
	});
});

describe("the generated root renders what Kit's root renders", () => {
	it.each([
		['/', { data_0: { site: 'S' }, data_1: { site: 'S', title: 'Home <&>' } }, {}],
		['/blog/[slug]', { data_0: null, data_1: null, data_2: { body: 'text' } }, { slug: 'hello' }],
		['/(marketing)/about', { data_0: { site: 'M' }, data_1: { site: 'M' } }, {}],
	])('%s', async (id, data, params) => {
		const cwd = project;
		const config = await configured(cwd);
		const manifest = create_manifest_data({ config, cwd });
		const kitOut = resolve(project, '.svelte-kit/kit');
		mkdirSync(kitOut, { recursive: true });
		write_root(manifest, config, kitOut);
		const found = await entries(project);
		compiled(project);

		const route = manifest.routes.find((one) => one.id === id);
		if (route?.page === null || route === undefined) throw new Error(`no page at ${id}`);
		const branch = [...route.page.layouts, route.page.leaf].filter(
			(one): one is number => one !== undefined,
		);
		const constructors = await Promise.all(
			branch.map(async (index) => {
				const component = manifest.nodes[index]?.component;
				if (component === undefined) throw new Error('a node without a component');
				const mod = (await import(
					pathToFileURL(resolve(cwd, component.replace(/\.svelte$/, '.js'))).href
				)) as { default: unknown };
				return mod.default;
			}),
		);
		const theirsMod = (await import(pathToFileURL(resolve(kitOut, 'root.js')).href)) as {
			default: never;
		};
		const page = {
			params,
			url: new URL('http://example.test/'),
			route: { id },
			status: 200,
			error: null,
			data: {},
			form: null,
			state: {},
		};
		const theirs = render(theirsMod.default, {
			props: {
				stores: {
					page: writable(null),
					navigating: writable(null),
					updated: { ...readable(false), check: async () => false },
				},
				page,
				constructors,
				components: [],
				form: null,
				...data,
			} as never,
		});

		const ours = found.find((one) => one.path === id);
		if (ours === undefined) throw new Error(`no root written for ${id}`);
		expect(ours.component).toBe(rootFile(id));
		const oursMod = (await import(
			pathToFileURL(resolve(project, ours.component.replace(/\.svelte$/, '.js'))).href
		)) as { default: never };
		const mine = render(oursMod.default, { props: { form: null, page, ...data } as never });
		expect(mine.body).toBe(theirs.body);
		expect(mine.head).toBe(theirs.head);
	});
});
