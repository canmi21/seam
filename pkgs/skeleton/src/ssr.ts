/**
 * A component rendered by Svelte per request, inside the bytes the program writes: declared so by
 * its author, or degraded to it by a refusal. The call site stands in the render as a copy that
 * writes a marker from its script, so every anchor the caller writes around a component call is the
 * caller's own, and the marker's hole renders the component with Svelte's `render` per request. See
 * spec/together.md, "Where SSR starts".
 */
import { readFileSync } from 'node:fs';
import { basename, dirname, resolve as resolvePath } from 'node:path';
import { parse } from 'svelte/compiler';
import { componentOf, importsOf, isComponentFile, projectAsync, resolveBare } from '@seam-js/ast';
import { rename } from './compose.ts';
import { type AstNode, isNode, refuse } from './node.ts';
import { marks } from './sentinel.ts';
import type { Walk } from './walk-types.ts';

/**
 * Thrown where a component cannot be rendered by SSR at its own call site and its caller has to be
 * instead: what the caller's own descent catches, as the component it is. Past the route's own
 * components it reaches the compile as a refusal, and the route is rendered by SSR whole.
 */
export class Climb extends Error {
	readonly why: string;
	/**
	 * Whether a declaration started it, which a page Svelte could render once at the build may not
	 * be: a component declared SSR is per request, and one degraded by a refusal is not.
	 */
	readonly declared: boolean;
	constructor(why: string, declared: boolean) {
		super(`${why}. See spec/together.md`);
		this.why = why;
		this.declared = declared;
	}
}

/** Thrown where nothing short of the route can be rendered by SSR: past every catch but the route's. */
export class WholeRoute extends Error {
	readonly declared: boolean;
	constructor(why: string, declared: boolean) {
		super(`${why}. See spec/together.md`);
		this.declared = declared;
	}
}

/** The name the declaration exports, and the one value it takes. See spec/together.md. */
const DECLARED = 'seam';

/**
 * Whether a component's module script declares it SSR: `export const seam = 'ssr'`, read off the
 * source. Any other value of `seam` is refused by name, so a typo is not a component quietly
 * compiled.
 */
export function declaredSsr(file: string, source: string = readFileSync(file, 'utf8')): boolean {
	if (!source.includes(DECLARED)) return false;
	let ast: AstNode;
	try {
		ast = parse(source, { modern: true }) as unknown as AstNode;
	} catch {
		return false;
	}
	const module = isNode(ast['module']) ? ast['module']['content'] : undefined;
	const body = isNode(module) && Array.isArray(module['body']) ? module['body'] : [];
	for (const statement of body) {
		if (!isNode(statement) || statement['type'] !== 'ExportNamedDeclaration') continue;
		const declaration = statement['declaration'];
		if (!isNode(declaration) || declaration['type'] !== 'VariableDeclaration') continue;
		for (const one of Array.isArray(declaration['declarations'])
			? declaration['declarations']
			: []) {
			if (!isNode(one) || !isNode(one['id']) || one['id']['name'] !== DECLARED) continue;
			const init = one['init'];
			if (declaration['kind'] === 'const' && isNode(init) && init['value'] === 'ssr') return true;
			refuse(
				`${basename(file)} exports \`${DECLARED}\`, which declares how the component renders and ` +
					"takes one value: `export const seam = 'ssr'`. See spec/together.md",
			);
		}
	}
	return false;
}

/** The components a component reaches through its imports, itself first, read once each. */
function subtree(file: string, seen = new Set<string>()): string[] {
	if (seen.has(file)) return [];
	seen.add(file);
	let source: string;
	try {
		source = readFileSync(file, 'utf8');
	} catch {
		return [];
	}
	const found = [file];
	for (const one of Object.values(importsOf(source))) {
		const target = one.from.startsWith('.')
			? resolvePath(dirname(file), one.from)
			: resolveBare(one.from, file);
		if (target === null) continue;
		const component = isComponentFile(target)
			? target
			: one.kind === 'default' || one.kind === 'named'
				? componentOf(
						one.from,
						[one.kind === 'default' ? 'default' : (one.exported ?? one.local)],
						file,
					)
				: null;
		if (component !== null && isComponentFile(component)) found.push(...subtree(component, seen));
	}
	return found;
}

/**
 * What a component's subtree does that is ordered or numbered across the whole page -- a head, an
 * id, a `hydratable` -- which a render of one component cannot know, however far up it starts; null
 * where it does none of them.
 */
function pageWide(file: string): string | null {
	for (const one of subtree(file)) {
		const source = readFileSync(one, 'utf8');
		const said = (what: string): string =>
			`${basename(one)} ${what}, which is ordered across the whole page, so the route renders by SSR`;
		if (source.includes('<svelte:head')) return said('writes a `<svelte:head>`');
		if (source.includes('$props.id(')) return said('counts an id with `$props.id()`');
		if (/\bhydratable\s*\(/.test(source)) return said('calls `hydratable`');
	}
	return null;
}

/** Whether a component between the route and here sets a context, which the program never holds. */
function setsContext(walk: Walk): string | null {
	for (const file of walk.site.stack) {
		if (/\bsetContext\s*\(/.test(readFileSync(file, 'utf8'))) return basename(file);
	}
	return /\bsetContext\s*\(/.test(walk.source) ? basename(walk.site.file) : null;
}

/**
 * The props the call site passes, as one object literal over the caller's names: each attribute as
 * written, each spread spread, an event handler as a function that does nothing, since a server
 * render never calls one. Null, with why, where the call site hands what the program cannot: markup,
 * a binding, a directive.
 */
function passed(node: AstNode, walk: Walk): { object: string } | { why: string } {
	const fragment = node['fragment'];
	const nodes = isNode(fragment) && Array.isArray(fragment['nodes']) ? fragment['nodes'] : [];
	if (
		nodes.some(
			(one) => !(isNode(one) && one['type'] === 'Text' && String(one['data']).trim() === ''),
		)
	) {
		return { why: "its caller hands it markup, which is the caller's and renders inside it" };
	}
	const parts: string[] = [];
	for (const one of Array.isArray(node['attributes']) ? node['attributes'] : []) {
		if (!isNode(one) || one['type'] === 'AttachTag') continue;
		if (one['type'] === 'SpreadAttribute') {
			parts.push(`...(${walk.expand(one['expression'])})`);
			continue;
		}
		if (one['type'] === 'BindDirective') return { why: 'its caller binds to it' };
		if (one['type'] !== 'Attribute')
			return { why: `its caller writes a ${String(one['type'])} on it` };
		const name = typeof one['name'] === 'string' ? one['name'] : '';
		const key = JSON.stringify(name);
		const value = one['value'];
		if (name.startsWith('on') && name.length > 2) {
			parts.push(`${key}: () => {}`);
			continue;
		}
		if (value === true) {
			parts.push(`${key}: true`);
			continue;
		}
		const pieces = Array.isArray(value) ? value : [value];
		const [only] = pieces;
		if (pieces.length === 1 && isNode(only) && only['type'] === 'ExpressionTag') {
			const expression = only['expression'];
			// A snippet the caller declares is markup of the caller's, handed as a value.
			if (
				isNode(expression) &&
				expression['type'] === 'Identifier' &&
				walk.snippets.has(String(expression['name']))
			) {
				return { why: "its caller hands it a snippet, which is the caller's markup" };
			}
			parts.push(`${key}: (${walk.expand(expression)})`);
			continue;
		}
		const text = pieces
			.map((part) =>
				isNode(part) && part['type'] === 'Text'
					? JSON.stringify(String(part['data'] ?? ''))
					: isNode(part) && part['type'] === 'ExpressionTag'
						? `String((${walk.expand(part['expression'])}) ?? '')`
						: '""',
			)
			.join(' + ');
		parts.push(`${key}: ${text === '' ? '""' : text}`);
	}
	return { object: `{ ${parts.join(', ')} }` };
}

/**
 * The call site of `tag` rendered by SSR, declared or degraded `why`, where it can be; otherwise a
 * `Climb` for its caller, or a `WholeRoute`. The component's subtree is recorded as SSR, with why,
 * for the coverage the build reports.
 */
export function ssrAt(
	node: AstNode,
	walk: Walk,
	tag: string,
	file: string,
	why: string,
	declared: boolean,
	dynamic?: unknown,
): true {
	const wide = pageWide(file);
	if (wide !== null) throw new WholeRoute(`${why}; and ${wide}`, declared);
	if (dynamic !== undefined) {
		throw new Climb(`${why}; and it is chosen per request, so its caller renders by SSR`, declared);
	}
	const setter = setsContext(walk);
	if (setter !== null) {
		throw new Climb(
			`${why}; and ${setter} above it sets a context, so its caller renders by SSR`,
			declared,
		);
	}
	const attributes = Array.isArray(node['attributes']) ? node['attributes'] : [];
	// A custom property on a component call is a wrapper element the caller writes around it, with
	// the property's value in it, which the stand-in would have to write as the caller would.
	if (attributes.some((one) => isNode(one) && String(one['name'] ?? '').startsWith('--'))) {
		throw new Climb(
			`${why}; and its caller sets a custom property on it, so its caller renders by SSR`,
			declared,
		);
	}
	const props = passed(node, walk);
	if ('why' in props) {
		throw new Climb(`${why}; and ${props.why}, so its caller renders by SSR`, declared);
	}
	// The stand-in takes none of them: what they say is the hole's, computed per request, and read in
	// the render they would be values no request holds.
	for (const one of attributes) {
		if (isNode(one) && typeof one['start'] === 'number' && typeof one['end'] === 'number') {
			walk.edits.push([one['start'], one['end'], '']);
		}
	}
	const index = walk.holes.length;
	const call = `$$ssr(${tag}, ${props.object}, $$render, $$request, $$options)`;
	walk.holes.push({ index, expression: projectAsync() ? `(await ${call})` : call, raw: true });
	const ordinal = walk.site.copies.length;
	// A copy that writes the marker from its script and nothing else, so the call is to the markup
	// around it what the original was. See `marks()`.
	const at = resolvePath(dirname(walk.site.file), `__seam-ssr-${String(index)}.svelte`);
	const stand = `<script>${marks(index)};</script>`;
	walk.site.copies.push({
		file: walk.site.file,
		at,
		source: stand,
		raw: stand,
		inner: [],
		within: [...walk.within],
	});
	rename(walk, node, tag, at, ordinal);
	walk.site.ssr.push({ file, why });
	return true;
}
