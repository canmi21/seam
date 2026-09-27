// The generated root against SvelteKit's own: both rendered by Svelte's server with the props each
// takes, and compared byte for byte. Kit's root is `runtime/components/root.svelte` as vendored,
// rendered with the `Props` and `RenderNode` tree Kit's `render_response` builds for the same
// route; ours takes the route's components and error pages as imports and its data as props. The
// comparison is what stands between this file and a drift in Kit's template.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compile, compileModule } from 'svelte/compiler';
import { render } from 'svelte/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aliases, configured, entries, rootFile, routes } from './index.ts';

// Inside the package rather than under the system's temporary directory: the compiled components
// import `svelte` by its bare name, which Node resolves from here and from nowhere else.
const project = resolve(dirname(fileURLToPath(import.meta.url)), '../.build-routes');
const here = createRequire(import.meta.url);
const server = resolve(dirname(here.resolve('svelte/package.json')), 'src/index-server.js');
const runtime = resolve(dirname(here.resolve('@sveltejs/kit/package.json')), 'src/runtime');
const kitOut = resolve(project, '.svelte-kit/kit');

const files: Record<string, string> = {
	'package.json': '{ "name": "sample", "private": true, "type": "module" }',
	// Kit's plugin syncs the project while the Vite config resolves, and the sync reads these.
	'src/app.html': '<!doctype html><html><head>%sveltekit.head%</head><body>%sveltekit.body%</body></html>',
	'src/routes/+layout.svelte':
		'<script>let { children, data } = $props();</script><header>{data?.site ?? "site"}</header>{@render children()}',
	'src/routes/+page.svelte': '<script>let { data } = $props();</script><h1>{data.title}</h1>',
	'src/routes/+error.svelte':
		'<script>let { error } = $props();</script><p class="root-error">{error?.message}</p>',
	'src/routes/blog/+layout.svelte':
		'<script>let { children } = $props();</script><section class="blog">{@render children()}</section>',
	'src/routes/blog/+error.svelte':
		'<script>let { error } = $props();</script><p class="blog-error">{error?.message}</p>',
	'src/routes/blog/[slug]/+page.svelte':
		'<script>let { data, params } = $props(); if (data.boom) throw new Error("boom");</script><article>{params.slug}: {data.body}</article>',
	'src/routes/(marketing)/about/+page.svelte': '<p>about</p>',
	'src/routes/api/+server.js': 'export function GET() { return new Response("x"); }',
	// The project's own configuration, read as Kit 3 reads it: the plugin's argument in the Vite
	// config, with an alias with and without `/*` and a file path the author moved, all relative
	// to the project rather than to whoever compiles it.
	'vite.config.js':
		"import { sveltekit } from '@sveltejs/kit/vite';\n" +
		"export default { logLevel: 'silent', plugins: [sveltekit({ alias: { $parts: 'src/parts', '$data/*': 'data/*' }, files: { assets: 'public' } })] };",
};

/**
 * A relative specifier from a compiled file to one of Kit's own, since the runner resolves an
 * absolute file URL into the repository as a root-relative id and then cannot find it.
 */
function toKit(from: string, file: string): string {
	const rel = relative(dirname(from), resolve(runtime, file)).split('\\').join('/');
	return JSON.stringify(rel.startsWith('.') ? rel : `./${rel}`);
}

/** Compiles a component to a `.js` at `to` that Node can import, Kit's own imports pointed at files. */
function compiledSource(source: string, at: string, to: string): string {
	return compile(source, { generate: 'server', name: 'C', filename: at, rootDir: project })
		.js.code.replace(/from '\$app\/navigation'/g, `from ${toKit(to, 'app/navigation/server.js')}`)
		.replace(/from '\.\.\/props\.svelte\.js'/g, "from './props.js'")
		.replace(/from 'svelte'/g, `from ${JSON.stringify(pathToFileURL(server).href)}`)
		.replace(/from '(\.[^']*)\.svelte'/g, "from '$1.js'");
}

/**
 * Where a compiled component lands: a mirror of the project under `.svelte-kit/compiled`, at the
 * same relative path, so that the relative imports the generated root writes resolve unchanged.
 * Beside the source would do, except that Kit reads `src/routes` and a `+error.js` there is a
 * name it reserves.
 */
const mirror = resolve(project, '.svelte-kit/compiled');
function compiledFile(file: string): string {
	return resolve(mirror, relative(project, resolve(project, file))).replace(/\.svelte$/, '.js');
}

/** Compiles every `.svelte` under a directory into the mirror. */
function compiled(dir: string): void {
	for (const name of readdirSync(dir, { withFileTypes: true })) {
		const at = join(dir, name.name);
		if (name.isDirectory()) {
			compiled(at);
			continue;
		}
		if (!name.name.endsWith('.svelte')) continue;
		const to = compiledFile(at);
		mkdirSync(dirname(to), { recursive: true });
		writeFileSync(to, compiledSource(readFileSync(at, 'utf8'), at, to));
	}
}

/** Kit's root and its `Props`, compiled from the vendored runtime as Kit's own build compiles them. */
function kitRoot(): void {
	mkdirSync(kitOut, { recursive: true });
	const props = compileModule(readFileSync(resolve(runtime, 'props.svelte.js'), 'utf8'), {
		generate: 'server',
		filename: 'props.svelte.js',
	}).js.code.replace(
		/from '\.\.\/utils\/functions\.js'/g,
		`from ${toKit(resolve(kitOut, 'props.js'), '../utils/functions.js')}`,
	);
	writeFileSync(resolve(kitOut, 'props.js'), props);
	const root = resolve(runtime, 'components/root.svelte');
	const to = resolve(kitOut, 'root.js');
	writeFileSync(to, compiledSource(readFileSync(root, 'utf8'), root, to));
}

beforeAll(() => {
	rmSync(project, { recursive: true, force: true });
	for (const [file, source] of Object.entries(files)) {
		mkdirSync(dirname(resolve(project, file)), { recursive: true });
		writeFileSync(resolve(project, file), source);
	}
	kitRoot();
});
afterAll(() => rmSync(project, { recursive: true, force: true }));

describe('the routes are read the way Kit reads them', () => {
	it('finds every page, its branch and the error page each level renders', async () => {
		const found = await routes(project);
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
		// Kit's `build_error_chain`: the root layout's failure is `error.html`, the blog layout's
		// is the root's error page, and the page's is the blog's.
		expect(blog?.errors).toEqual([
			undefined,
			'src/routes/+error.svelte',
			'src/routes/blog/+error.svelte',
		]);
		const home = found.pages.find((one) => one.id === '/');
		expect(home?.branch).toEqual(['src/routes/+layout.svelte', 'src/routes/+page.svelte']);
		expect(home?.errors).toEqual([undefined, 'src/routes/+error.svelte']);
		// A group adds no level and declares no error page, so the depth above is rewound past it.
		expect(found.pages.find((one) => one.id === '/(marketing)/about')?.errors).toEqual([
			undefined,
			'src/routes/+error.svelte',
		]);
	});
});

describe("the configuration is the project's, resolved against it", () => {
	it("reads the plugin's argument off the Vite config and spells every path absolute", async () => {
		const config = await configured(project);
		expect(config.files.assets).toBe(resolve(project, 'public'));
		expect(config.files.routes).toBe(resolve(project, 'src/routes'));
		expect(await aliases(project)).toEqual({
			$parts: resolve(project, 'src/parts'),
			$data: resolve(project, 'data'),
		});
	});
});

interface Level {
	component: unknown;
	error: unknown;
	data: Record<string, unknown>;
}

/** Kit's `transformError`, as `render_response` hands it to the render, standing in for its own. */
const transformError = (error: unknown): { message: string; status: number } => ({
	message: `handled: ${(error as Error).message}`,
	status: 500,
});

describe("the generated root renders what Kit's root renders", () => {
	it.each([
		['/', [{ site: 'S' }, { title: 'Home <&>' }], {}, false],
		['/blog/[slug]', [{}, {}, { body: 'text' }], { slug: 'hello' }, false],
		['/blog/[slug]', [{}, {}, { boom: true }], { slug: 'hello' }, true],
		['/(marketing)/about', [{ site: 'M' }, {}], {}, false],
	])('%s', async (id, data, params, throws) => {
		const found = await entries(project);
		compiled(resolve(project, 'src'));
		compiled(resolve(project, '.svelte-kit/seam'));
		const page = (await routes(project)).pages.find((one) => one.id === id);
		if (page === undefined) throw new Error(`no page at ${id}`);

		const load = async (file: string): Promise<unknown> =>
			((await import(pathToFileURL(compiledFile(file)).href)) as { default: unknown }).default;
		// Kit's tree, built as `render_response` builds it: each level's data is everything
		// above it merged with its own.
		const levels: Level[] = [];
		const merged: Record<string, unknown> = {};
		for (const [at, file] of page.branch.entries()) {
			Object.assign(merged, data[at]);
			const error = page.errors[at];
			levels.push({
				component: await load(file),
				error: error === undefined ? undefined : await load(error),
				data: { ...merged },
			});
		}
		const { Props, RenderNode } = (await import(
			pathToFileURL(resolve(kitOut, 'props.js')).href
		)) as {
			Props: new (given: Record<string, unknown>) => object;
			RenderNode: new (
				component: unknown,
				error: unknown,
			) => { data: Record<string, unknown>; child?: object };
		};
		const tree = new RenderNode(levels[0]?.component, levels[0]?.error);
		let current = tree;
		for (const [at, level] of levels.entries()) {
			current.data = level.data;
			const next = levels[at + 1];
			if (next === undefined) break;
			current = current.child = new RenderNode(next.component, next.error);
		}
		const request = {
			params,
			url: new URL('http://example.test/'),
			route: { id },
			status: 200,
			error: null,
			data: {},
			form: null,
			state: {},
		};
		const theirsMod = (await import(pathToFileURL(resolve(kitOut, 'root.js')).href)) as {
			default: never;
		};
		const theirs = await render(theirsMod.default, {
			props: new Props({ page: request, tree, form: null, error: undefined }) as never,
			transformError,
		});

		const ours = found.find((one) => one.path === id);
		if (ours === undefined) throw new Error(`no root written for ${id}`);
		expect(ours.component).toBe(rootFile(id));
		const oursMod = (await import(pathToFileURL(compiledFile(ours.component)).href)) as {
			default: never;
		};
		const props: Record<string, unknown> = { form: null, page: request, error: undefined };
		for (const [at, level] of levels.entries()) props[`data_${String(at)}`] = level.data;
		const mine = await render(oursMod.default, { props: props as never, transformError });
		expect(mine.body).toBe(theirs.body);
		expect(mine.head).toBe(theirs.head);
		expect(mine.body.includes('blog-error')).toBe(throws);
	});
});
