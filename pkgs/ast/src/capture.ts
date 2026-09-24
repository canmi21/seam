import { parse } from 'svelte/compiler';
import { apply, type Edit } from './edits.ts';
import { parsed } from './locals.ts';
import { bound, isNode, reads } from './scope.ts';

/** The name a file's script runner is read under in a derivation, from that file's carried scope. */
export const RUN_NAME = '$$run';

/** The context key the capture reads its function from, which the runner sets per render. */
export const CAPTURE = 'seam:capture';

/**
 * The context key a run's `hydratable` reads the request's from, which the runner sets per render.
 * Through the render's context rather than anything global, since requests run side by side.
 */
export const HYDRATING = 'seam:hydratable';

/**
 * A component's source with its markup replaced by a capture of every name its instance script
 * declares, for Svelte to compile and a derivation to run per request.
 *
 * The scripts stay exactly as written, and so does `<svelte:options>`: the mode and every statement
 * are Svelte's to read. What replaces the markup is one expression handing the names to a function
 * the render's context supplies, and it sits where the template would, which is after every `$:`
 * has run -- so what it captures is what the markup would have read. A `$x` is captured beside `x`
 * wherever the source subscribes to it. See spec/derivation.md, "Where substitution cannot follow,
 * the script runs as Svelte compiled it".
 */
export function captured(source: string): string {
	const ast = parse(source, { modern: true }) as unknown as Record<string, unknown>;
	const instance = ast['instance'];
	const module = ast['module'];
	const names = declaredAtTop(instance);
	const stores = new Set<string>();
	for (const [, name] of source.matchAll(/(?<![\w$])\$([A-Za-z_][\w]*)/g)) {
		if (name !== undefined && names.has(name)) stores.add(`$${name}`);
	}
	const fields = [...names, ...stores].map((one) => `${JSON.stringify(one)}: ${one}`).join(', ');
	const importing = "import { getContext as __seam_context } from 'svelte';";
	const script = isNode(instance)
		? spliced(source, instance, importing, hydrating(instance))
		: `<script>${importing}</script>`;
	const options = isNode(ast['options']) ? slice(source, ast['options']) : '';
	return [
		options,
		isNode(module) ? slice(source, module) : '',
		script,
		`{__seam_context(${JSON.stringify(CAPTURE)})({ ${fields} })}`,
	].join('\n');
}

/**
 * The edits that hand the instance block's import of Svelte's `hydratable` the request's: the
 * import keeps a name nothing reads, and the author's name is declared over a call into the
 * render's context, where the runner puts the request's record. Svelte's own would record into
 * the run's render, which nobody reads. See spec/derivation.md, "Where substitution cannot follow,
 * the script runs as Svelte compiled it".
 */
function hydrating(instance: Record<string, unknown>): Edit[] {
	const content = instance['content'];
	const body = isNode(content) && Array.isArray(content['body']) ? content['body'] : [];
	const edits: Edit[] = [];
	const locals: string[] = [];
	for (const statement of body) {
		if (!isNode(statement) || statement['type'] !== 'ImportDeclaration') continue;
		const from = statement['source'];
		if (!isNode(from) || from['value'] !== 'svelte') continue;
		const specifiers = statement['specifiers'];
		for (const one of Array.isArray(specifiers) ? specifiers : []) {
			if (!isNode(one) || one['type'] !== 'ImportSpecifier') continue;
			const imported = one['imported'];
			const local = one['local'];
			if (!isNode(imported) || imported['name'] !== 'hydratable' || !isNode(local)) continue;
			const { start, end } = one;
			if (typeof start !== 'number' || typeof end !== 'number') continue;
			if (typeof local['name'] !== 'string') continue;
			edits.push([start, end, `hydratable as __seam_hydratable${String(locals.length)}`]);
			locals.push(local['name']);
		}
	}
	if (locals.length === 0) return edits;
	const at = isNode(content) ? content['start'] : undefined;
	if (typeof at !== 'number') return [];
	const declared = locals
		.map(
			(name) =>
				`const ${name} = (key, fn) => __seam_context(${JSON.stringify(HYDRATING)})(key, fn);`,
		)
		.join(' ');
	edits.push([at, at, declared]);
	return edits;
}

/** Every name the instance block declares at its top level, a `$:` it assigns included. */
function declaredAtTop(instance: unknown): Set<string> {
	const found = new Set<string>();
	const content = isNode(instance) ? instance['content'] : undefined;
	const body = isNode(content) && Array.isArray(content['body']) ? content['body'] : [];
	for (const statement of body) {
		if (!isNode(statement)) continue;
		const type = statement['type'];
		const declaration =
			type === 'ExportNamedDeclaration' && isNode(statement['declaration'])
				? statement['declaration']
				: statement;
		if (declaration['type'] === 'VariableDeclaration') {
			const declarations = declaration['declarations'];
			for (const one of Array.isArray(declarations) ? declarations : []) {
				if (isNode(one)) bound(one['id'], found);
			}
		} else if (
			declaration['type'] === 'FunctionDeclaration' ||
			declaration['type'] === 'ClassDeclaration'
		) {
			bound(declaration['id'], found);
		} else if (type === 'LabeledStatement' && isNode(statement['label'])) {
			// `$: x = ...` over a name nothing declares is one Svelte declares for it.
			if (statement['label']['name'] !== '$') continue;
			const body = statement['body'];
			const expression = isNode(body) ? body['expression'] : undefined;
			if (isNode(expression) && expression['type'] === 'AssignmentExpression') {
				bound(expression['left'], found);
			}
		}
	}
	return found;
}

/** A block's source, with edits made inside it, and with a statement put first inside it. */
function spliced(
	source: string,
	block: Record<string, unknown>,
	statement: string,
	edits: readonly Edit[] = [],
): string {
	const start = block['start'];
	const whole = apply(slice(source, block), edits, typeof start === 'number' ? start : 0);
	const open = whole.indexOf('>') + 1;
	return `${whole.slice(0, open)}${statement}${whole.slice(open)}`;
}

function slice(source: string, node: Record<string, unknown>): string {
	const start = node['start'];
	const end = node['end'];
	return typeof start === 'number' && typeof end === 'number' ? source.slice(start, end) : '';
}

/**
 * An expression with every read of one of `names` from outside it written as `as(name)`: a
 * property name, a key and a name a function inside binds are not reads, and a shorthand property
 * keeps its key. The expression comes back unchanged where it cannot be parsed.
 */
export function readsReplaced(
	expression: string,
	names: ReadonlySet<string>,
	as: (name: string) => string,
): string {
	let tree: Record<string, unknown>;
	try {
		tree = parsed(expression) as unknown as Record<string, unknown>;
	} catch {
		return expression;
	}
	const fragment = tree['fragment'];
	const nodes = isNode(fragment) && Array.isArray(fragment['nodes']) ? fragment['nodes'] : [];
	const [tag] = nodes;
	if (!isNode(tag)) return expression;
	const wrapped = '<script lang="ts"></script>{'.length;
	const edits: Edit[] = [];
	reads(tag['expression'], new Set(), (at, shorthand) => {
		const name = at['name'];
		const start = at['start'];
		const end = at['end'];
		if (typeof name !== 'string' || !names.has(name)) return;
		if (typeof start !== 'number' || typeof end !== 'number') return;
		edits.push([
			start - wrapped,
			end - wrapped,
			shorthand === true ? `${name}: ${as(name)}` : as(name),
		]);
	});
	return apply(expression, edits);
}
