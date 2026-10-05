/**
 * The SvelteKit project the plugin's checks build and serve: one page per seam between Kit and the
 * render this compiler replaced, each written the way an application met it. Shared by the build's
 * check (`plugin.test.ts`) and the dev server's (`dev.test.ts`). See spec/framework.md.
 */
import { createRequire } from 'node:module';
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const plugin = resolve(dirname(fileURLToPath(import.meta.url)), '../index.ts');

/** The two Kits a project is built with: upstream's, read-only, and the fork. */
export const VENDOR = dirname(createRequire(import.meta.url).resolve('@sveltejs/kit/package.json'));
export const FORK = resolve(dirname(fileURLToPath(import.meta.url)), '../../../framework');

/**
 * How a build is made: by Kit alone, by the fork, or by Kit with this plugin beside it, which is
 * the config's `seam()` and a project's way in until it takes the fork.
 */
export type Mode = 'kit' | 'fork' | 'beside';

/**
 * The project's `@sveltejs/kit`, as an install would put it: Kit's own, or the fork where the
 * project has swapped it in by the alias. Kit's plugin, the code it generates and this plugin all
 * reach Kit by that name from the project.
 */
export function linked(project: string, mode: Mode): void {
	const at = resolve(project, 'node_modules/@sveltejs/kit');
	mkdirSync(dirname(at), { recursive: true });
	rmSync(at, { force: true });
	symlinkSync(mode === 'fork' ? FORK : VENDOR, at, 'dir');
}

export const files: Record<string, string> = {
	// `#lib` is Kit 3's spelling of `$lib`: a subpath import the project declares.
	'package.json':
		'{ "name": "sample", "private": true, "type": "module", "imports": { "#lib/*": "./src/lib/*" } }',
	// A virtual module of the project's own, the shape press's site config takes: nothing on disk
	// answers it, so the render has to resolve it the way the project's build does.
	'vite.config.js':
		"import { sveltekit } from '@sveltejs/kit/vite';\n" +
		`import { seam } from ${JSON.stringify(pathToFileURL(plugin).href)};\n` +
		"const site = { name: 'virtual-site', resolveId(id) { return id === 'virtual:site' ? '\\0virtual:site' : null; }, " +
		"load(id) { return id === '\\0virtual:site' ? 'export const site = { name: \"Sample <site>\" };' : null; } };\n" +
		// A compile-time macro the way StyleX is one: a plugin of the project's compiles `tone(...)`
		// away in a module that imports it from `sample-macro` by that name, and the call left in
		// place throws. See spec/build.md, "A bare import a project's plugin reads by its name".
		"const macro = { name: 'sample-macro', transform(code, id) { if (!/\\.(svelte|[jt]s)$/.test(id) || !/from ['\"]sample-macro['\"]/.test(code)) return null; return code.replace(/tone\\((['\"][a-z]+['\"])\\)/g, (_, name) => '({ class: \"tone-\" + ' + name + ' })'); } };\n" +
		// Kit 3 takes its options as the plugin's argument; a `svelte.config.js` is an error. The version
		// is named because Kit's default is the time its config module was loaded, and the fork's is
		// loaded apart from Kit's, so each build would name its own and every page would differ by it.
		"export default { logLevel: 'silent', plugins: [sveltekit({ outDir: process.env.SEAM_OUT, version: { name: 'sample' }, alias: { $parts: 'src/parts' }, extensions: ['.svelte', '.svx', '.svelte.md'] }), site, macro, ...(process.env.SEAM === 'beside' ? [seam()] : [])] };",
	'src/app.html':
		'<!doctype html><html lang="en"><head>%sveltekit.head%</head><body><div style="display: contents">%sveltekit.body%</div></body></html>',
	'src/routes/+layout.server.js': "export function load() { return { tagline: 'a sample' }; }",
	'src/routes/+layout.svelte':
		"<script>import { page } from '$app/state'; import { dev } from '$app/environment'; import { site } from 'virtual:site'; import { shout } from '#lib/shout.ts'; import Nav from '$parts/nav.svelte'; let { children, data } = $props();</script>" +
		'<svelte:head><link rel="canonical" href={`https://sample.test${page.url.pathname}`} /></svelte:head>' +
		'<header>{site.name}: {data.tagline}{dev ? " (dev)" : ""}</header><p>{shout(data.tagline)}</p><Nav /><main>{@render children()}</main>',
	// Carried: a function a derivation calls, reaching a virtual module, which only the project's
	// own bundler can resolve.
	'src/lib/shout.ts':
		"import { site } from 'virtual:site';\nexport const shout = (s) => `${site.name}: ${s}`.toUpperCase();",
	// A link through Kit's own `resolve`, which with `paths.relative` on writes `..` per segment of the
	// URL being answered, so every page at every depth writes a different one.
	'src/parts/nav.svelte':
		"<script>import { page } from '$app/state'; import { resolve } from '$app/paths';</script><nav class:home={page.url.pathname === '/'}><a href={resolve('/run')}>run</a>{page.route.id}</nav>",
	'src/routes/+page.server.js':
		"export function load() { return { title: 'Home & away', items: ['a', '<b>', 'c'] }; }",
	'src/routes/+page.svelte':
		'<script>let { data } = $props();</script><svelte:head><title>{data.title}</title></svelte:head>' +
		'<h1>{data.title}</h1><ul>{#each data.items as item}<li>{item}</li>{/each}</ul>',
	'src/routes/+error.svelte':
		"<script>import { page } from '$app/state';</script><h1>{page.status}: {page.error?.message}</h1>",
	// A load that throws under a matched route renders the error page under that route's id.
	'src/routes/blog/[slug]/+page.server.js':
		"import { error } from '@sveltejs/kit';\nexport function load({ params }) { if (params.slug === 'gone') error(404, 'no such post'); return { body: `post ${params.slug}`, draft: params.slug.startsWith('d') }; }",
	'src/routes/blog/[slug]/+page.svelte':
		'<script>let { data, params } = $props();</script><article>{params.slug}: {data.body}</article>{#if data.draft}<em>draft</em>{/if}',
	// A page whose script changes a name over the request's data: substitution cannot follow it, so
	// the page's script runs as Svelte compiled it, carried through the project's own Vite. The page
	// is a child of Kit's generated root, which is every page an author writes.
	'src/routes/run/+page.server.js': 'export function load() { return { count: 21 }; }',
	// A page under an extension the config adds, which Kit's `options` app does: read as a module to
	// carry rather than a component, it was refused for the guard the root's boundary writes.
	// And one named like a runes module, `.svelte.md`, whose staged copy kept the name and was
	// compiled again by Svelte's Vite plugin as one. Kit's `options` `custom-extensions/[slug]`.
	'src/routes/ext/[slug]/+page.svelte.md':
		"<script>import { page } from '$app/state';</script><h2>{page.params.slug.toUpperCase()}</h2>",
	// The build's mode, which `import.meta.env.MODE` reads in a `load` and in markup: Kit's `options`
	// app builds with `--mode custom`. The markup's read was a derivation that did not parse.
	'src/routes/mode/+page.js':
		'export function load() { return { fromLoad: import.meta.env.MODE }; }',
	'src/routes/mode/+page.svelte':
		"<script>import { mode } from '#lib/mode.js'; let { data } = $props();</script><h2>{data.fromLoad} === {import.meta.env.MODE} === {mode}</h2>",
	'src/lib/mode.js': 'export const mode = import.meta.env.MODE;',
	'node_modules/sample-macro/package.json':
		'{ "name": "sample-macro", "type": "module", "exports": "./index.js" }',
	'node_modules/sample-macro/index.js':
		"export function tone() { throw new Error('tone() must be compiled away'); }",
	'src/routes/toned/+page.svelte':
		"<script module>import { tone } from 'sample-macro'; const look = tone('warm');</script><p class={look.class}>toned</p>",
	// The server's environment, read through a module of the project's named by what it compiles
	// to: the build answered it with the empty environment it ran in. `status`'s `projectUrl()`.
	'src/env.ts':
		"import { defineEnvVars } from '@sveltejs/kit/env';\nexport const variables = defineEnvVars({ PUBLIC_WHERE: { public: true, schema: (input) => input ?? '' } });",
	'src/lib/where.ts':
		"import { PUBLIC_WHERE } from '$app/env/public';\nexport function where() { return PUBLIC_WHERE?.replace(/\\/$/, '') || undefined; }",
	'src/routes/where/+layout.svelte':
		"<script>import { hints } from 'sample-icons/hints.js'; import { dev } from '$app/environment'; import { where } from '#lib/where.js'; let { children } = $props(); const at = where(); const early = hints({ fonts: ['https://fonts.test'], ...(at ? { data: at } : {}) }, { dev });</script><svelte:head>{#each early as one (one.href)}<link rel=\"preconnect\" href={one.href} />{/each}</svelte:head>{@render children()}",
	'src/routes/where/+page.svelte': '<p>where</p>',
	// An instance the request reaches, made once per request as Svelte makes it once per render:
	// substituted it was a new one at every read, and one compared with itself was not itself.
	'src/lib/box.ts': 'export class Box { v: number; constructor(v: number) { this.v = v; } }',
	'src/routes/box/+page.server.js': 'export function load() { return { n: 3 }; }',
	'src/routes/box/+page.svelte':
		"<script>import { Box } from '#lib/box.js'; let { data } = $props(); const box = new Box(data.n);</script><p>{box === box} {box.v}</p>",
	// An icon from a package installed through a link, outside the project, the way
	// `@lucide/svelte` is: see `outside()`.
	'src/routes/icons/+page.svelte':
		'<script>import Star from \'sample-icons/Star.svelte\';</script><Star size={16} aria-hidden="true" class="dark:hidden" />',
	'src/routes/ext/+page.svx':
		"<script>import { page } from '$app/state';</script><p>custom: {page.url.pathname}</p>",
	// Error pages, rendered from the trees Kit renders them with: a layout's `load` throwing under a
	// section with an error page of its own, and the page beneath it throwing, which renders that
	// section's error page inside its layout. See spec/framework.md, "What is still Kit's render".
	'src/routes/shop/+layout.server.js':
		"import { error } from '@sveltejs/kit';\nexport function load({ url }) { if (url.pathname === '/shop/closed') error(503, 'shop closed'); return { section: 'Shop' }; }",
	'src/routes/shop/+layout.svelte':
		'<script>let { children, data } = $props();</script><section><h2>{data.section}</h2>{@render children()}</section>',
	'src/routes/shop/+error.svelte':
		'<script>import { page } from \'$app/state\'; let { error } = $props();</script><p class="shop-error">{page.status} {error.message}</p>',
	'src/routes/shop/[item]/+page.server.js':
		"import { error } from '@sveltejs/kit';\nexport function load({ params }) { if (params.item === 'sold') error(410, `${params.item} is gone`); return { item: params.item }; }",
	'src/routes/shop/[item]/+page.svelte':
		'<script>let { data } = $props();</script><p>{data.item}</p>',
	'src/routes/shop/closed/+page.svelte': '<p>never</p>',
	// A module script that reads what a server has not got, which the compile cannot evaluate and
	// Kit's render throws on: Kit's `no-ssr/ssr-page-config/layout/overwrite`.
	'src/routes/left/+page.svelte': '<script module>document;</script><p>{document}</p>',
	'src/routes/run/+page.svelte':
		'<script>let { data } = $props(); let n = data.count; n = n * 2;</script><p>run: {n}</p>',
	// A `$derived.by` that pushes to an array and joins it, which runs whenever the markup reads it:
	// written out it was two arrays and the page read ''. Kit's `remote/form/skip-submit`.
	'src/routes/derived/+page.svelte':
		"<script>const log = []; const joined = $derived.by(() => { log.push(7); return log.join(', '); });</script><p>joined: {joined}</p>",
	// A store a relative module exports, beside a binding that module changes, read as `$mode`: the
	// shape of Kit's `load/invalidation/multiple/redirect`, where the read was left as `$mode` and
	// named nothing at request time.
	'src/routes/store/state.js':
		"import { writable } from 'svelte/store';\nlet count = 0;\nexport const mode = writable('initial');\nexport function bump() { count++; }",
	// A worker's URL, which Kit's build writes under `_app/immutable/workers/`: Kit's `no-csr` app
	// links one, and the carried bundle wrote the library build's `/assets/` path instead.
	'src/routes/worker/work.js': 'self.onmessage = () => {};',
	'src/routes/worker/+page.svelte':
		"<script>import url from './work.js?worker&url';</script><a href={url}>worker</a>",
	// A component a universal `load` returns, rendered by the page with `<svelte:component>`: Kit's
	// `basics` `load/dynamic-import-styles`, which threw the unnamed-component error per request.
	// See spec/framework.md, "A component a `load` returns".
	'src/routes/loaded/+page.js':
		"export async function load({ url }) { return { Thing: url.searchParams.has('none') ? null : (await import('./_/Thing.svelte')).default }; }",
	'src/routes/loaded/+page.svelte':
		'<script>export let data;</script><svelte:component this={data.Thing} />',
	'src/routes/loaded/_/Thing.svelte':
		'<p id="thing">this text is red</p><style>p { color: red; }</style>',
	// A component its author declared SSR, rendered by Svelte per request in the program's bytes,
	// its props computed from the page's data. See spec/together.md.
	'src/lib/twice.svelte':
		'<script module>export const seam = \'ssr\';</script><script>let { n } = $props();</script><p class="twice">{n * 2}</p><style>.twice { color: blue; }</style>',
	'src/routes/clocked/+page.server.js': 'export function load() { return { n: 21 }; }',
	'src/routes/clocked/+page.svelte':
		"<script>import Twice from '#lib/twice.svelte'; let { data } = $props();</script><h2>clocked</h2><Twice n={data.n} /><p>after</p>",
	// Literal markup in the shape of the compile's own marker, which it cannot tell from one: refused,
	// and rendered by SSR rather than failing the build. See spec/together.md.
	'src/routes/marker/+page.server.js': "export function load() { return { x: 'value' }; }",
	'src/routes/marker/+page.svelte':
		'<script>let { data } = $props();</script><p>%%s0%% here</p><p>{data.x}</p>',
	'src/routes/store/+page.svelte':
		"<script>import { mode, bump } from './state.js'; function go() { mode.set('x'); bump(); }</script><button onclick={go}>go</button><p>mode: {$mode}</p>",
};

export const URLS = [
	'/',
	'/blog/hello',
	'/blog/draft',
	'/blog/gone',
	'/shop/hat',
	'/shop/sold',
	'/shop/closed',
	'/left',
	'/ext',
	'/ext/test-slug',
	'/where',
	'/box',
	'/icons',
	'/mode',
	'/toned',
	'/blog/hello/__data.json',
	'/missing',
	'/run',
	'/store',
	'/worker',
	'/derived',
	'/loaded',
	'/loaded?none',
	'/marker',
	'/clocked',
];
/**
 * A package of the shape `@lucide/svelte` has, written outside the project and linked into its
 * `node_modules` as pnpm links one: an icon whose script reads a context through the package's own
 * module, whose props default to one another, which takes a `$derived` apart by an array pattern and
 * spreads what it got, and which writes a `<svelte:head>` -- hashed by its path, which is outside the
 * project. `status` met each of these at once.
 */
export function outside(project: string): void {
	const at = resolve(project, '../.build-plugin-icons');
	rmSync(at, { recursive: true, force: true });
	const icons: Record<string, string> = {
		'package.json':
			'{ "name": "sample-icons", "type": "module", "exports": { "./*": { "svelte": "./dist/*", "default": "./dist/*" } } }',
		'dist/ctx.js':
			"import { getContext } from 'svelte';\nexport const ctx = () => getContext('sample-icons');",
		'dist/build.js':
			"export const build = (size, width, rest) => ['svg', { class: 'icon', width, height: size, ...rest }];",
		'dist/Icon.svelte':
			"<script>import { ctx } from './ctx.js'; import { build } from './build.js'; const g = ctx() ?? {}; const { size = g.size ?? 24, width = size, class: given, ...rest } = $props(); const [, attrs] = $derived(build(size, width, rest)); const all = $derived({ ...attrs, class: [attrs.class, g.class, given].filter(Boolean).join(' ') });</script><svelte:head><meta name=\"icon\" content=\"seen\" /></svelte:head><svg {...all}></svg>",
		'dist/hints.js':
			'export const hints = (asked, options) => [...asked.fonts.map((href) => ({ href })), ...(asked.data ? [{ href: asked.data }] : [])].filter(() => !options.dev);',
		'dist/Star.svelte':
			"<script>import Icon from './Icon.svelte'; let props = $props();</script><Icon {...props} />",
	};
	for (const [file, source] of Object.entries(icons)) {
		mkdirSync(dirname(resolve(at, file)), { recursive: true });
		writeFileSync(resolve(at, file), source);
	}
	mkdirSync(resolve(project, 'node_modules'), { recursive: true });
	symlinkSync(at, resolve(project, 'node_modules/sample-icons'), 'dir');
}

/** Writes a project's files under `project`, from nothing. */
export function written(project: string, sources: Record<string, string>): void {
	rmSync(project, { recursive: true, force: true });
	for (const [file, source] of Object.entries(sources)) {
		mkdirSync(dirname(resolve(project, file)), { recursive: true });
		writeFileSync(resolve(project, file), source);
	}
}
