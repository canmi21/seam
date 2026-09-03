/**
 * The hydration entry, generated per route.
 *
 * It is one route's entry and knows nothing about the others. A client router needs a map from URL
 * to component with a deferred import for each, and what that waits on is written down in
 * spec/build.md; the shape here is what a document needs to become interactive, and nothing more.
 *
 * It is a virtual module rather than a file. Writing a staging directory and deleting it afterwards
 * is what this did before a plugin existed, and generating a module is what a bundler plugin is
 * for.
 */
/**
 * The public id, which is what the bundler is given as an entry, and the resolved one, which
 * carries the `\0` that marks a module no file backs.
 *
 * They are two spellings on purpose. A bundler names an output chunk after its entry, and it
 * cannot derive a name from an id beginning with a null byte, so the entry it is handed has to be
 * the readable form.
 *
 * `virtual:` is Vite's own convention and is not decoration. An id shaped like `hydrate:...` reads
 * as a URL scheme, and Vite leaves an unknown scheme alone as something outside the bundle, so the
 * entry resolved to nothing and the build emitted no files at all.
 */
const PUBLIC = 'virtual:hydrate/';
const RESOLVED = `\0${PUBLIC}`;

/** What the bundler is given. The component travels in the id, so nothing is looked up twice. */
export function idFor(component: string): string {
	return `${PUBLIC}${component}`;
}

export function resolvedIdFor(component: string): string {
	return `${RESOLVED}${component}`;
}

export function isEntry(id: string): boolean {
	return id.startsWith(PUBLIC);
}

export function componentOf(id: string): string | null {
	return id.startsWith(RESOLVED) ? id.slice(RESOLVED.length) : null;
}

/**
 * `devalue.parse` rather than `JSON.parse`, and one prop rather than a spread: both halves of what
 * the server wrote have to be read back the way they were written. See spec/payload.md.
 */
export function source(component: string): string {
	return `import { hydrate } from 'svelte';
import { parse } from 'devalue';
import Component from ${JSON.stringify(component)};

const script = document.querySelector('[data-payload]');
const target = document.getElementById('app');
if (script === null || target === null) throw new Error('no payload or no target');

hydrate(Component, { target, props: { data: parse(script.textContent ?? 'null') } });
`;
}
