/**
 * The build's check of a route against the props it was rendered with in development: its program
 * and Svelte's render of the route's generated root, over each payload kept for it, byte for byte.
 * See spec/together.md, "The props a page was rendered with, kept and replayed".
 *
 * Both run through the build's loader -- the program over its carried names as one module the loader
 * evaluates, the root as the loader's Svelte plugin compiles it for the server -- so what differs
 * between them is the compile and nothing about where their modules came from.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { ViteDevServer } from 'vite';
import { carriedNames, carriedSource } from '@seam-js/carry';
import type { Route } from '@seam-js/compiler';
import { script } from '@seam-js/program';
import { evaluated, type Render } from '@seam-js/runtime';
import { keptFor } from './payloads.ts';

type Output = { body: string; head: string; hashes?: { script?: unknown } };
type SvelteRender = (component: unknown, options: Record<string, unknown>) => Output;

/** What Kit's `transformError` writes into the page, without a project's `handleError`. */
function handled(page: Record<string, unknown> | undefined): (error: unknown) => unknown {
	return (error) => {
		const thrown = error as { status?: unknown; body?: unknown; location?: unknown } | null;
		if (thrown !== null && typeof thrown === 'object' && typeof thrown.location === 'string') {
			throw error;
		}
		const status = typeof thrown?.status === 'number' ? thrown.status : 500;
		const body = thrown?.body ?? { message: 'Internal Error' };
		if (page !== undefined) {
			page['error'] = body;
			page['status'] = status;
		}
		return body;
	};
}

/** A copy of a payload whose page is its own, since a render writes a caught error into it. */
function copied(payload: Record<string, unknown>): Record<string, unknown> {
	const page = payload['page'] as Record<string, unknown> | undefined;
	return { ...payload, page: page === undefined ? undefined : { ...page } };
}

function pageOf(props: Record<string, unknown>): Record<string, unknown> | undefined {
	return props['page'] as Record<string, unknown> | undefined;
}

/** Kit's request context, its page the one this render was given. */
function context(props: Record<string, unknown>): Map<string, unknown> {
	return new Map([['__request__', { page: pageOf(props) }]]);
}

function scripts(one: Output): unknown[] {
	return Array.isArray(one.hashes?.script) ? (one.hashes.script as unknown[]) : [];
}

async function settled(output: Output | Promise<Output>): Promise<Output> {
	return output;
}

/**
 * The check the build runs a route through, made once per build over the loader: null where the
 * route's program agrees with Svelte's render over every payload kept for it, or why not.
 */
export function verifier(
	loader: ViteDevServer,
	artifacts: string,
): (route: Route) => Promise<string | null> {
	let prepared: Promise<{ render: SvelteRender }> | null = null;
	const prepare = (): NonNullable<typeof prepared> => {
		prepared ??= (async () => {
			// What `$$env()` reads, which the build's dispatcher hands from Kit's own build.
			const env = resolve(artifacts, 'verify', 'env.js');
			mkdirSync(dirname(env), { recursive: true });
			writeFileSync(env, 'export default import.meta.env;\n');
			const handed = ((globalThis as Record<symbol, Record<string, unknown> | undefined>)[
				Symbol.for('seam.kit')
			] ??= {});
			handed['import.meta.env'] = (
				(await loader.ssrLoadModule(env)) as { default: unknown }
			).default;
			const server = (await loader.ssrLoadModule('svelte/server')) as { render: SvelteRender };
			return { render: server.render };
		})();
		return prepared;
	};

	return async (route) => {
		const kept = keptFor(artifacts, route.path);
		if (kept.length === 0) return null;
		const { render } = await prepare();
		const source = carriedSource(route.file, route.names);
		let files: Record<string, Record<string, unknown>> = {};
		if (source !== '') {
			const name = createHash('sha256').update(`${route.file}\n${source}`).digest('hex');
			const file = resolve(artifacts, 'verify', `${name.slice(0, 16)}.js`);
			writeFileSync(file, `${source}\n`);
			files = ((await loader.ssrLoadModule(file)) as { files: typeof files }).files;
		}
		const program: Render = evaluated(
			script(route.structure, '', carriedNames(route.names, route.file, true)),
			files,
		);
		const Root = ((await loader.ssrLoadModule(route.file)) as { default: unknown }).default;
		for (const { file, payload } of kept) {
			const theirs = copied(payload);
			let kit: Output | { threw: string };
			try {
				kit = await settled(
					render(Root, {
						props: theirs,
						context: context(theirs),
						transformError: handled(pageOf(theirs)),
					}),
				);
			} catch (error) {
				kit = { threw: String(error) };
			}
			// Inside a render of Svelte's, as the build's dispatcher runs it inside Kit's.
			const ours = copied(payload);
			const out: { value?: Output } = {};
			let mine: Output | { threw: string };
			try {
				await settled(
					render(
						($$renderer: { child: (run: () => Promise<void>) => void }) => {
							const done = program(ours, { transformError: handled(pageOf(ours)) });
							if (typeof (done as Promise<unknown>).then === 'function') {
								$$renderer.child(async () => {
									out.value = (await done) as Output;
								});
							} else {
								out.value = done as Output;
							}
						},
						{ context: context(ours) },
					),
				);
				mine = out.value ?? { threw: 'nothing came back' };
				// The check of the check: a program made to write the wrong bytes. See spec/together.md.
				if ('body' in mine && process.env['SEAM_VERIFY_FAULT'] === route.path) {
					mine = { ...mine, body: `${mine.body}<!--seam-fault-->` };
				}
			} catch (error) {
				mine = { threw: String(error) };
			}
			const same =
				'threw' in kit || 'threw' in mine
					? 'threw' in kit && 'threw' in mine
					: kit.body === mine.body &&
						kit.head === mine.head &&
						JSON.stringify(scripts(kit)) === JSON.stringify(scripts(mine));
			if (same) continue;
			writeFileSync(`${file}.svelte.txt`, JSON.stringify(kit, null, '\t'));
			writeFileSync(`${file}.program.txt`, JSON.stringify(mine, null, '\t'));
			return `its program disagreed with Svelte's render over the props kept in ${file}`;
		}
		return null;
	};
}
