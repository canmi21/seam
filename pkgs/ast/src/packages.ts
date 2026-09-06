// Finding the `.svelte` file a package exports a component from, so the walk can enter it.
//
// A package's component is a component like any other, and the walk enters it the way it enters
// one the project holds; what stands between the tag and the file is module resolution, which a
// bundler does and this pass has to do for itself. Two steps, both read out of what Node and
// Svelte do rather than invented: the bare specifier is resolved through the package's `exports`
// map under the `svelte` condition, the way `vite-plugin-svelte` asks Node to, and the export is
// then followed through the JavaScript a `svelte-package` build writes -- `export { default as
// Root } from './root.svelte'`, `export * as Dialog from './exports.js'` -- until a `.svelte` file
// is reached or the chain ends in something that is not a component. See spec/refusals.md.
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'svelte/compiler';
import { isNode, type Node } from './scope.ts';

/** The conditions a Svelte-aware bundler resolves an `exports` map under, in the order it tries. */
const CONDITIONS: ReadonlySet<string> = new Set(['svelte', 'import', 'module', 'default']);

/** What a specifier names once the package name is taken off the front: `.` or `./sub/path`. */
function split(specifier: string): [name: string, subpath: string] | null {
	if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('file:')) {
		return null;
	}
	const parts = specifier.split('/');
	const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? '');
	if (name === '' || (specifier.startsWith('@') && parts.length < 2)) return null;
	const rest = specifier.slice(name.length);
	return [name, rest === '' ? '.' : `.${rest}`];
}

/**
 * The directory of the nearest `node_modules/<name>` above `from`, or null. Walked from the real
 * path, as Node walks it: a package a package manager links into place has its own dependencies
 * beside its real location and not beside the link.
 */
function packageDir(name: string, from: string): string | null {
	let at = dirname(real(from));
	for (;;) {
		const candidate = resolvePath(at, 'node_modules', name);
		if (existsSync(resolvePath(candidate, 'package.json'))) return candidate;
		const up = dirname(at);
		if (up === at) return null;
		at = up;
	}
}

/**
 * One target of an `exports` map resolved under the conditions, or null. A string is the answer;
 * an object is tried condition by condition in the map's own key order, as Node does; an array
 * is the first entry that resolves.
 */
function target(value: unknown, star: string | null): string | null {
	if (typeof value === 'string') {
		if (!value.startsWith('./')) return null;
		return star === null ? value : value.replaceAll('*', star);
	}
	if (Array.isArray(value)) {
		for (const one of value) {
			const found = target(one, star);
			if (found !== null) return found;
		}
		return null;
	}
	if (typeof value === 'object' && value !== null) {
		for (const [condition, inner] of Object.entries(value)) {
			if (!CONDITIONS.has(condition)) continue;
			const found = target(inner, star);
			if (found !== null) return found;
		}
	}
	return null;
}

/**
 * The prefix aliases a bundler applies before it resolves anything: `$lib` to `src/lib`, and a
 * project's own under `kit.alias`. Set once per compile from the project's configuration, by the
 * one package that reads it; empty, nothing is aliased.
 */
let aliases: readonly [find: string, replacement: string][] = [];

export function configureAliases(map: Readonly<Record<string, string>>): void {
	// Longest first, so `$lib/server` wins over `$lib` where both are declared.
	aliases = Object.entries(map).toSorted((a, b) => b[0].length - a[0].length);
}

/** What is configured, for a bundler that has to be told the same. */
export function currentAliases(): Readonly<Record<string, string>> {
	return Object.fromEntries(aliases);
}

/** The path an aliased specifier stands for, or null where no alias matches it. */
function aliased(specifier: string): string | null {
	for (const [find, replacement] of aliases) {
		if (specifier === find) return replacement;
		if (specifier.startsWith(`${find}/`)) return replacement + specifier.slice(find.length);
	}
	return null;
}

// Vite's `resolve.extensions`, in its order, then the index files; a component is written with
// its extension, so `.svelte` is not among them.
const EXTENSIONS = ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json'];

/** A path as a file, the way a bundler completes one written without its extension. */
function withExtension(path: string): string | null {
	const file = (candidate: string): boolean => {
		try {
			return statSync(candidate).isFile();
		} catch {
			return false;
		}
	};
	if (file(path)) return path;
	for (const ext of EXTENSIONS) if (file(path + ext)) return path + ext;
	for (const ext of EXTENSIONS) {
		const index = resolvePath(path, `index${ext}`);
		if (file(index)) return index;
	}
	return null;
}

/**
 * A bare specifier as the file it names, resolved the way a Svelte-aware bundler resolves it:
 * through the package's `exports` under the `svelte` condition first, and where a package has no
 * map, through its `svelte`, `module` and `main` fields or the subpath as a file. A relative or
 * absolute specifier comes back resolved against `from`. Null where nothing is found.
 */
export function resolveBare(specifier: string, from: string): string | null {
	const alias = aliased(specifier);
	if (alias !== null) return withExtension(alias);
	const named = split(specifier);
	if (named === null) {
		if (specifier.startsWith('file:')) return fileURLToPath(specifier);
		// Completed as a bundler completes it -- `./x.svelte` may be the runes module `x.svelte.ts`
		// -- and left as written where nothing is found, for a caller asking about a file that is
		// not there yet.
		const plain = resolvePath(dirname(from), specifier);
		return withExtension(plain) ?? plain;
	}
	const [name, subpath] = named;
	const dir = packageDir(name, from);
	if (dir === null) return null;
	let manifest: Record<string, unknown>;
	try {
		manifest = JSON.parse(readFileSync(resolvePath(dir, 'package.json'), 'utf8')) as Record<
			string,
			unknown
		>;
	} catch {
		return null;
	}

	const exports = manifest['exports'];
	if (exports !== undefined && exports !== null) {
		// A map whose keys are subpaths, or a bare target that stands for `.` alone.
		const map: Record<string, unknown> =
			typeof exports === 'object' &&
			!Array.isArray(exports) &&
			Object.keys(exports).some((key) => key.startsWith('.'))
				? (exports as Record<string, unknown>)
				: { '.': exports };
		const exact = map[subpath];
		if (exact !== undefined) {
			const found = target(exact, null);
			return found === null ? null : resolvePath(dir, found);
		}
		// A pattern, `./icons/*`, matched on the longest prefix as Node matches it.
		let best: [string, unknown] | null = null;
		for (const [key, value] of Object.entries(map)) {
			const at = key.indexOf('*');
			if (at < 0) continue;
			const prefix = key.slice(0, at);
			const suffix = key.slice(at + 1);
			if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) continue;
			if (subpath.length < prefix.length + suffix.length) continue;
			if (best === null || key.length > best[0].length) best = [key, value];
		}
		if (best !== null) {
			const at = best[0].indexOf('*');
			const star = subpath.slice(at, subpath.length - (best[0].length - at - 1));
			const found = target(best[1], star);
			return found === null ? null : resolvePath(dir, found);
		}
		return null;
	}

	if (subpath === '.') {
		for (const field of ['svelte', 'module', 'main']) {
			const value = manifest[field];
			if (typeof value === 'string') return resolvePath(dir, value);
		}
		return resolvePath(dir, 'index.js');
	}
	const direct = resolvePath(dir, subpath);
	for (const candidate of [direct, `${direct}.js`, resolvePath(direct, 'index.js')]) {
		if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
	}
	return null;
}

function real(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
}

/** The statements of a JavaScript module, read with the parser Svelte reads a script with. */
function statements(file: string): Node[] | null {
	let code: string;
	try {
		code = readFileSync(file, 'utf8');
	} catch {
		return null;
	}
	try {
		const ast = parse(`<script>${code}</script>`, { modern: true }) as unknown as Node;
		const instance = ast['instance'];
		const content = isNode(instance) ? instance['content'] : undefined;
		const body = isNode(content) ? content['body'] : undefined;
		return Array.isArray(body) ? body.filter(isNode) : null;
	} catch {
		return null;
	}
}

function nameOf(node: unknown): string | null {
	if (!isNode(node)) return null;
	if (node['type'] === 'Identifier' && typeof node['name'] === 'string') return node['name'];
	if (node['type'] === 'Literal' && typeof node['value'] === 'string') return node['value'];
	return null;
}

/**
 * The `.svelte` file a module's export names, followed through however many re-exports stand
 * between them, or null where the chain ends anywhere else.
 *
 * `names` is the path to the component from the module: `['default']` for a default export,
 * `['Root']` for a named one, `['DropdownMenu', 'Root']` for a member of a namespace export. Each
 * step is one of the forms a package build writes, read off the module's own statements rather
 * than evaluated: a re-export with a source, an export of an imported name, `export * as` and
 * `export *`, and a default export of an imported name.
 */
export function componentOf(
	specifier: string,
	names: readonly string[],
	from: string,
	depth = 0,
): string | null {
	if (depth > 32) return null;
	const file = resolveBare(specifier, from);
	if (file === null) return null;
	if (file.endsWith('.svelte')) {
		return names.length === 1 && names[0] === 'default' && existsSync(file) ? file : null;
	}
	const [head, ...rest] = names;
	if (head === undefined) return null;
	const body = statements(file);
	if (body === null) return null;

	/** What this module imports under a local name, as the module and the name there. */
	const imports = new Map<string, [source: string, names: string[]]>();
	for (const statement of body) {
		if (statement['type'] !== 'ImportDeclaration') continue;
		const source = nameOf(statement['source']);
		if (source === null) continue;
		for (const one of Array.isArray(statement['specifiers']) ? statement['specifiers'] : []) {
			if (!isNode(one)) continue;
			const local = nameOf(one['local']);
			if (local === null) continue;
			if (one['type'] === 'ImportDefaultSpecifier') imports.set(local, [source, ['default']]);
			else if (one['type'] === 'ImportNamespaceSpecifier') imports.set(local, [source, []]);
			else if (one['type'] === 'ImportSpecifier') {
				imports.set(local, [source, [nameOf(one['imported']) ?? local]]);
			}
		}
	}
	const through = (local: string): string | null => {
		const held = imports.get(local);
		if (held === undefined) return null;
		return componentOf(held[0], [...held[1], ...rest], file, depth + 1);
	};

	for (const statement of body) {
		const type = statement['type'];
		const source = nameOf(statement['source']);
		if (type === 'ExportNamedDeclaration') {
			for (const one of Array.isArray(statement['specifiers']) ? statement['specifiers'] : []) {
				if (!isNode(one) || nameOf(one['exported']) !== head) continue;
				const local = nameOf(one['local']);
				if (local === null) return null;
				// `export { default as Root } from './root.svelte'`, or `export { Root }` of a name
				// this module imported.
				return source === null
					? through(local)
					: componentOf(source, [local, ...rest], file, depth + 1);
			}
			continue;
		}
		if (type === 'ExportAllDeclaration' && source !== null) {
			const exported = nameOf(statement['exported']);
			// `export * as Dialog from './exports.js'` names a namespace; the member is looked for
			// in that module.
			if (exported !== null) {
				if (exported === head) return componentOf(source, rest, file, depth + 1);
				continue;
			}
			// `export * from './bits/index.js'` passes every name through; the first module that
			// has it wins, which is what a bundler resolves as well.
			const found = componentOf(source, names, file, depth + 1);
			if (found !== null) return found;
			continue;
		}
		if (type === 'ExportDefaultDeclaration' && head === 'default') {
			const local = nameOf(statement['declaration']);
			return local === null ? null : through(local);
		}
	}
	return null;
}
