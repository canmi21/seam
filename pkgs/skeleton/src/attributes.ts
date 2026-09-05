import type { Locals } from 'ast';
import { type AstNode, isNode, refuse, span } from './node.ts';
import { sentinel } from './sentinel.ts';
import type { Hole } from './shape.ts';
import type { Copy } from './walk.ts';

/**
 * The three attribute forms that are not one value written into one place.
 *
 * `class:` and `style:` are decisions: the value never reaches the bytes, only its truthiness
 * does, and Svelte reassembles the whole attribute around it. `{...}` is the opposite -- the keys
 * themselves arrive with the request, so nothing about the run can be enumerated. Each is taken
 * over here before the ordinary walk sees the attributes, and each returns the attributes it took
 * charge of so the walk does not visit them twice.
 *
 * What is planted here is only an anchor. The outcomes and the rest of a spread's call need the
 * render that has not happened yet, so both are finished in `resolve.ts`.
 */

/**
 * How many outcomes a single element's class directives may have.
 *
 * The outcomes are enumerated, so `n` directives on one element cost `2^n` strings. Four directives
 * is past anything measured -- the most on one element in a real application is two -- and the
 * limit exists so the cost is refused with a number in it rather than paid quietly.
 */
export const CHOICES = 16;

/**
 * What a class decision needs before the render, which is everything but the scoping hash.
 *
 * The hash is a hash of the filename and of the stylesheet, and Svelte appends it to the class
 * itself, so the only place to read it without reproducing it is the render this pass is about to
 * make. The outcomes are finished afterwards, in `skeleton`.
 */
export interface PendingChoice {
	index: number;
	tests: string[];
	/**
	 * `class` for a class attribute's directives, `style` for a style attribute's, and `value`
	 * for a class written as one expression on an element the stylesheet scopes: `to_class`
	 * writes the value and the hash with a space between, or the hash alone when the value is
	 * empty, which is a decision on the value with the value inside one of its outcomes.
	 */
	kind: 'class' | 'style' | 'value' | 'expression';
	/** For `value`: the hole standing for the class's value, which the non-empty outcome holds. */
	value?: number;
	/**
	 * For `expression`: the class's value as one expression, with `clsx` around it where Svelte's
	 * analysis puts one. The hole's expression is `attr_class` of it, the hash and the directives,
	 * written once the render has said what the hash is.
	 */
	written?: string;
	names: string[];
	/** The attribute as written, or the empty string where there was none. */
	base: string;
	/**
	 * A style decision's declarations, in source order: what to write for the value when it is
	 * present, whether it carries `!important`, and whether it is a decision at all.
	 *
	 * A declaration written with plain text is always present and needs no test; one written with
	 * an expression is present when the value is neither null nor the empty string, which is the
	 * rule `to_style` applies, and stands as a marker of its own per outcome so that every hole is
	 * consumed exactly once.
	 */
	declarations?: {
		name: string;
		important: boolean;
		literal: string | null;
		expression: string | null;
	}[];
}

/** A spread waiting for the rest of its call, which only the compiled output has. */
export interface PendingSpread {
	index: number;
	object: string;
	/**
	 * The copy this element sits in, or null for the entry. A child walked into is compiled as its
	 * own file, so the call to read the arguments back out of is in that file's output rather than
	 * in the entry's.
	 */
	copy: Copy | null;
}

/** The attribute name a spread's marker is written under, which nothing else could produce. */
export function probe(index: number): string {
	return `data-seam-${String(index)}`;
}

/**
 * An element whose attributes a spread decides, written as one value the runtime produces.
 *
 * Read out of `build_spread_object` and `prepare_element_spread`, and out of what they compile to.
 * An element carrying a spread does not write its attributes one at a time: every attribute and
 * every spread on it is merged into one object and handed to `$.attributes(object, hash, classes,
 * styles, flags)`, which walks the object's keys at request time. Which keys those are is what
 * cannot be known here, and it is the only thing that cannot.
 *
 * So the marker stands for the whole run rather than for one attribute in it, and the expression
 * behind it is that same call: the object rebuilt from the source, and every other argument taken
 * verbatim from what Svelte compiled. The hash, the flags for a namespaced or case-preserving or
 * input element, the merging order -- none of it is worked out here. `attributes` itself is
 * bundled with the component's other carried functions, so the two backends run one implementation
 * rather than agreeing about a rule.
 *
 * @returns the attributes this took charge of, which the caller must not walk again.
 */
export function spread(
	source: string,
	node: AstNode,
	holes: Hole[],
	edits: [number, number, string][],
	expand: Locals['rewrite'],
	pending: PendingSpread[],
	copy: Copy | null,
): ReadonlySet<unknown> {
	const empty: ReadonlySet<unknown> = new Set();
	const attributes = Array.isArray(node['attributes']) ? node['attributes'] : [];
	if (!attributes.some((one) => isNode(one) && one['type'] === 'SpreadAttribute')) return empty;
	if (node['type'] !== 'RegularElement') {
		refuse(
			'`{...}` on a `<svelte:element>` is not handled yet: the tag and the attributes are each ' +
				'decided per request, and only one of the two is written',
		);
	}

	// The object, in the order `build_spread_object` builds it: every attribute and every spread,
	// as written, left to right.
	const parts: string[] = [];
	for (const one of attributes) {
		if (!isNode(one)) return empty;
		if (one['type'] === 'SpreadAttribute') {
			parts.push(`...(${expand(one['expression'])})`);
			continue;
		}
		if (one['type'] !== 'Attribute') {
			refuse(
				`\`${source.slice(...(span(one) ?? [0, 0])).slice(0, 40)}\` beside a \`{...}\` is not ` +
					'handled yet: a directive on an element whose attributes are spread is a fourth ' +
					'argument to the one call that writes them',
			);
		}
		const name = typeof one['name'] === 'string' ? one['name'] : '';
		const key = JSON.stringify(name);
		const value = one['value'];
		// An event handler is in the object and skipped by name when the attributes are written, so
		// what it holds never reaches the bytes. Null keeps it out of the derivation.
		if (name.startsWith('on') && name.length > 2) {
			parts.push(`${key}: null`);
			continue;
		}
		if (value === true) {
			parts.push(`${key}: true`);
			continue;
		}
		const written = Array.isArray(value) ? value : [value];
		if (written.every((part) => isNode(part) && part['type'] === 'Text')) {
			parts.push(
				`${key}: ${JSON.stringify(written.map((part) => String(part['data'] ?? '')).join(''))}`,
			);
			continue;
		}
		const [only] = written;
		if (written.length !== 1 || !isNode(only) || only['type'] !== 'ExpressionTag') {
			refuse(
				`\`${name}\` beside a \`{...}\` mixes text and an expression, which is one value once ` +
					'the attributes are merged; this reads a single expression',
			);
		}
		parts.push(`${key}: (${expand(only['expression'])})`);
	}

	const index = holes.length;
	// Filled in after the render, which is where the rest of the call comes from.
	holes.push({ index, expression: '', raw: true, spread: true });
	pending.push({ index, object: `{ ${parts.join(', ')} }`, copy });

	// Everything the element wrote is replaced by one spread of one key, so that the render writes
	// a marker where the run belongs and the call keeps the arguments the element decides.
	const at = span(attributes[0]);
	const last = span(attributes[attributes.length - 1]);
	if (at !== null && last !== null) {
		edits.push([
			at[0],
			last[1],
			`{...{ ${JSON.stringify(probe(index))}: ${JSON.stringify(sentinel(index))} }}`,
		]);
	}
	return new Set(attributes);
}

/**
 * `class:` is one decision over the whole class attribute, not an addition beside it.
 *
 * Read out of Svelte's server transform rather than guessed. `build_attr_class` collects every
 * directive on the element and emits a single `$.attr_class(value, hash, directives)`, and
 * `to_class` appends the name of each truthy directive **and removes the name of each falsy one
 * from the value it was handed**. So a directive is not something added to a class attribute: it
 * decides what the attribute is, and it can decide the attribute away entirely -- `class="on"` with
 * `class:on={false}` writes no class attribute at all. The analysis phase also invents an empty
 * class attribute when a directive has none to work with, at the end of the attribute list, which
 * is why one written here goes there too.
 *
 * The value never reaches the bytes; only its truthiness does. That makes this a decision position
 * in the sense spec/pipeline.md sets out, and a decision is compilable when its outcomes can be
 * enumerated. These can: `2^n` of them, each computed by calling Svelte's own `attr_class`, so
 * neither the joining nor the removal nor the escaping nor the empty result is reproduced here.
 *
 * What is planted is a marker as the whole class value, with the directives deleted. That is the
 * anchor: the render then carries ` class="<marker> <hash>"` at exactly the position the attribute
 * belongs, which lowering already knows how to find and replace whole. See spec/refusals.md.
 *
 * @returns the attributes this took charge of, which the caller must not walk again.
 */
export function classes(
	node: AstNode,
	holes: Hole[],
	edits: [number, number, string][],
	expand: Locals['rewrite'],
	pending: PendingChoice[],
): ReadonlySet<unknown> {
	const empty: ReadonlySet<unknown> = new Set();
	// An element, written or decided per request: `build_element_attributes` is one function and
	// runs for both. Anything else carrying one of these is refused where it always was, which
	// says what the construct is rather than what its attribute would have been.
	if (node['type'] !== 'RegularElement' && node['type'] !== 'SvelteElement') return empty;
	const attributes = Array.isArray(node['attributes']) ? node['attributes'] : [];
	const directives = attributes.filter(
		(one): one is AstNode => isNode(one) && one['type'] === 'ClassDirective',
	);
	if (directives.length === 0) return empty;

	if (1 << directives.length > CHOICES) {
		refuse(
			`this element has ${String(directives.length)} \`class:\` directives, which is ` +
				`${String(1 << directives.length)} outcomes to enumerate. The mechanism is enumeration, ` +
				`so the limit is ${String(CHOICES)}`,
		);
	}

	const attribute = attributes.find(
		(one) => isNode(one) && one['type'] === 'Attribute' && one['name'] === 'class',
	);
	let base = '';
	let written: string | undefined;
	if (isNode(attribute)) {
		const value = attribute['value'];
		const parts = value === true ? [] : Array.isArray(value) ? value : [value];
		if (parts.every((part) => isNode(part) && part['type'] === 'Text')) {
			base = parts.map((part) => String((part as AstNode)['data'] ?? '')).join('');
		} else {
			// A value the request writes: `build_attr_class` hands it to `to_class` with the hash and
			// the directives, and a falsy directive removes its own name from it, so the outcome is
			// a string that exists per request. The call is Svelte's own, carried, with the value as
			// `build_attribute_value` builds it: one expression through `clsx` where the analysis
			// says it needs one, or a template literal where text stands beside it.
			const [only] = parts;
			written =
				parts.length === 1 && isNode(only) && only['type'] === 'ExpressionTag'
					? clsxed(only['expression'], expand)
					: joined(parts, expand);
		}
	}

	const index = holes.length;
	const tests = directives.map((one) => expand(one['expression']));
	const names = directives.map((one) => String(one['name']));
	if (written === undefined) {
		holes.push({ index, expression: '', raw: false, choice: { tests, outcomes: [] } });
		pending.push({ index, tests, kind: 'class', names, base });
	} else {
		holes.push({ index, expression: '', raw: true, whole: true });
		pending.push({ index, tests, kind: 'expression', names, base, written });
	}

	// The marker is appended to the class rather than put in place of it, and the directives stay
	// where they are. Both matter, and neither was obvious: whether Svelte scopes an element is
	// decided by whether a selector in the `<style>` matches it, and it matches against the class
	// attribute's *text* and against the directive names -- `css-prune.js` reads a `ClassDirective`
	// for exactly that. Replacing the text with an expression, or deleting a directive, tells the
	// analysis the element is no longer selected, and the scoping hash then never reaches the
	// render this pass reads it out of. Measured: the hash silently went missing.
	//
	// Every directive is made false so that nothing is appended after the marker, which leaves the
	// hash as the whole of what follows it and makes reading it a `slice` rather than a parse.
	for (const one of directives) {
		const at = span(one);
		if (at !== null) edits.push([at[0], at[1], `class:${String(one['name'])}={false}`]);
	}
	const marker = sentinel(index);
	const at = span(attribute);
	if (at !== null && written !== undefined) {
		// As one expression the analysis cannot read, so the element stays scoped as the author's
		// expression left it, and the hash follows the marker the way it follows the value.
		edits.push([at[0], at[1], `class={(0, ${JSON.stringify(marker)})}`]);
	} else if (at !== null) {
		edits.push([at[0], at[1], `class="${base === '' ? marker : `${base} ${marker}`}"`]);
	} else {
		// Where Svelte's own invented one goes, which is after every attribute that was written.
		const last = Math.max(...attributes.map((one) => span(one)?.[1] ?? 0));
		edits.push([last, last, ` class="${marker}"`]);
	}

	return new Set(isNode(attribute) ? [...directives, attribute] : directives);
}

/**
 * `style:` is the same decision as `class:`, with the value written inside the outcome.
 *
 * Read out of `build_attr_style` and `to_style`. It is not the cheap half of the pair the way an
 * earlier note in spec/refusals.md guessed: the whole attribute is reassembled. The base is
 * re-parsed as CSS -- comments stripped, quotes and parentheses tracked -- every declaration in it
 * whose name a directive also names is **dropped**, each surviving one is re-emitted as ` x;`, then
 * the directives are appended, normal ones first and `!important` ones after, and the result is
 * trimmed. So `style="color:red"` beside a directive is not written as it was written.
 *
 * A declaration is present when its value is neither null nor the empty string, which is a decision
 * with the value substituted inside it. That is what stopped this before: a marker can stand where
 * the value goes, and nothing could stand where the declaration's presence is decided. Enumerating
 * gives both -- `2^n` outcomes, each one built by calling `attr_style` with markers for the values
 * that are present -- and **each outcome gets markers of its own**, so a value that appears in half
 * the outcomes is still a hole consumed exactly once.
 *
 * @returns the attributes this took charge of, which the caller must not walk again.
 */
/**
 * A class value as one expression, through `clsx` where Svelte puts one.
 *
 * `2-analyze/visitors/Attribute.js`: `class={x}` needs `clsx` to resolve arrays and objects unless
 * the expression is a literal, a template or a binary expression, which can only be a string.
 */
export function clsxed(expression: unknown, expand: Locals['rewrite']): string {
	const type = isNode(expression) ? expression['type'] : undefined;
	const written = `(${expand(expression)})`;
	if (type === 'Literal' || type === 'TemplateLiteral' || type === 'BinaryExpression')
		return written;
	return `clsx(${written})`;
}

/**
 * Text and expressions joined the way `build_attribute_value` joins them: a template literal, with
 * `$.stringify` around each expression -- a string as it is, null and undefined as nothing,
 * anything else through `+ ''`.
 */
function joined(parts: readonly unknown[], expand: Locals['rewrite']): string {
	const pieces = parts.map((part) => {
		if (!isNode(part)) return '';
		if (part['type'] === 'Text') {
			return String(part['data'] ?? '')
				.replace(/\\/g, '\\\\')
				.replace(/`/g, '\\`')
				.replace(/\$\{/g, '\\${');
		}
		return `\${(${expand(part['expression'])}) ?? ''}`;
	});
	return `\`${pieces.join('')}\``;
}

export function styles(
	source: string,
	node: AstNode,
	holes: Hole[],
	edits: [number, number, string][],
	expand: Locals['rewrite'],
	pending: PendingChoice[],
): ReadonlySet<unknown> {
	const empty: ReadonlySet<unknown> = new Set();
	if (node['type'] !== 'RegularElement' && node['type'] !== 'SvelteElement') return empty;
	const attributes = Array.isArray(node['attributes']) ? node['attributes'] : [];
	const directives = attributes.filter(
		(one): one is AstNode => isNode(one) && one['type'] === 'StyleDirective',
	);
	if (directives.length === 0) return empty;

	const attribute = attributes.find(
		(one) => isNode(one) && one['type'] === 'Attribute' && one['name'] === 'style',
	);
	let base = '';
	if (isNode(attribute)) {
		const value = attribute['value'];
		const parts = value === true ? [] : Array.isArray(value) ? value : [value];
		if (!parts.every((part) => isNode(part) && part['type'] === 'Text')) {
			refuse(
				'`style:` beside a `style` whose value is an expression is not handled yet: the ' +
					'attribute is reassembled from both, and a declaration in that value whose name a ' +
					'directive also names is dropped, so which bytes exist is decided by a string that ' +
					'only exists per request',
			);
		}
		base = parts.map((part) => String((part as AstNode)['data'] ?? '')).join('');
	}

	const declarations: PendingChoice['declarations'] & object = [];
	const tests: string[] = [];
	for (const one of directives) {
		const raw = typeof one['name'] === 'string' ? one['name'] : '';
		// `to_css_name`: a custom property keeps its case, everything else is lowered.
		const name = raw.startsWith('--') ? raw : raw.toLowerCase();
		const important = Array.isArray(one['modifiers']) && one['modifiers'].includes('important');
		const value = one['value'];
		// The shorthand, which Svelte reads as the variable of the same name.
		const parts = value === true ? null : Array.isArray(value) ? value : [value];

		if (parts !== null && parts.every((part) => isNode(part) && part['type'] === 'Text')) {
			const text = parts.map((part) => String((part as AstNode)['data'] ?? '')).join('');
			// Written text, so it is present or not once and for all rather than per request.
			declarations.push({ name, important, literal: text === '' ? null : text, expression: null });
			continue;
		}

		const only = parts === null ? one['expression'] : parts.length === 1 ? parts[0] : undefined;
		const inner = parts === null ? only : isNode(only) ? only['expression'] : undefined;
		// Text beside an expression is one value: `build_attribute_value` joins the parts into a
		// template literal with each expression through `$.stringify`, which writes nothing for
		// null and undefined. So that is what is written here, as one expression.
		const written = isNode(inner) ? expand(inner) : joined(parts ?? [], expand);
		declarations.push({ name, important, literal: null, expression: written });
		// Svelte's own test, from `append_styles`: `value != null && value !== ''`. Truthiness is
		// not it -- `style:width={0}` writes `width: 0;`.
		tests.push(`(${written}) != null && (${written}) !== ''`);
	}

	if (1 << tests.length > CHOICES) {
		refuse(
			`this element has ${String(tests.length)} \`style:\` directives with values decided per ` +
				`request, which is ${String(1 << tests.length)} outcomes to enumerate. The mechanism is ` +
				`enumeration, so the limit is ${String(CHOICES)}`,
		);
	}

	const index = holes.length;
	holes.push({ index, expression: '', raw: false, choice: { tests, outcomes: [] } });
	pending.push({ index, tests, kind: 'style', names: [], base, declarations });

	for (const one of directives) {
		const at = span(one);
		if (at !== null) edits.push([at[0], at[1], `style:${String(one['name'])}={null}`]);
	}
	// A declaration of its own, so the render puts the marker inside a `style="..."` run and the
	// assembler finds the attribute the way it finds any other. Its name is not one a directive can
	// reserve, and a custom property keeps its case through `to_css_name`.
	const anchor = `style="--seam-at: ${sentinel(index)}"`;
	const at = span(attribute);
	if (at !== null) {
		edits.push([at[0], at[1], anchor]);
	} else {
		const last = Math.max(...attributes.map((one) => span(one)?.[1] ?? 0));
		edits.push([last, last, ` ${anchor}`]);
	}

	return new Set(isNode(attribute) ? [...directives, attribute] : directives);
}
