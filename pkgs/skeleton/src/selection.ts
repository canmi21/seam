/**
 * What a tag's attributes select: the props a call site passes, the values a marker can and
 * cannot stand in, and the groups a caller's markup is handed to a child in. See spec/refusals.md.
 */
import { type Locals, objectEntries } from 'ast';
import { identity } from './compose.ts';
import { type AstNode, extent, isNode, refuse, span } from './node.ts';
import { sentinel } from './sentinel.ts';
import type { Hole } from './shape.ts';
import { opening } from './unbind.ts';
import { chose } from './branches.ts';
import { assigned } from './dynamic.ts';
import { stamped } from './stamps.ts';
import { type Given, type Group, type Walk } from './walk-types.ts';
import { asWritten, slotOf } from './written.ts';

/**
 * Markup that reaches the server and writes nothing, so the walk steps over it.
 *
 * Each of these is measured rather than assumed: `corpus/cases/inert.svelte` holds them all
 * and its expected bytes are Svelte's own.
 */
export const INERT = new Set([
	'Comment',
	'SvelteWindow',
	'SvelteBody',
	'SvelteDocument',
	'SvelteOptions',
	'OnDirective',
	'UseDirective',
	'TransitionDirective',
	'AnimateDirective',
	// No server visitor emits one: `shared/component.js` puts it into a component's props, where
	// nothing on the server calls it, and an element's is not visited at all.
	'AttachTag',
	'DebugTag',
	// Read where the caller's markup is grouped, not where it is written: a `let:` names what the
	// component supplies to the slot it belongs to, and `hands()` collects it. `build_inline_component`
	// puts it in the slot function's parameter and writes nothing for it here. See `Given.handed`.
	'LetDirective',
]);

/**
 * Markup this pass has not been taught, and what to tell the author about it.
 *
 * Every message names one of the three situations `spec/refusals.md` sets out: the shape is
 * understood and unwritten, the protocol has no answer yet, or there is another way to write it.
 * A refusal that says only that something is wrong has failed.
 */
export const REFUSED: Record<string, string> = {
	BindDirective:
		'this `bind:` is one the server writes, and the value has nowhere to be planted: `bind:` ' +
		'takes a name rather than an expression, so a marker cannot stand where the value goes. The ' +
		'bindings that write nothing are handled',
};

/**
 * Whether a group holds anything Svelte writes a slot function for.
 *
 * `build_inline_component` visits the group and drops it where the block comes out empty --
 * `if (block.body.length === 0) continue` -- and whitespace around a named slot's element is what
 * `clean_nodes` takes out. `<Child a="b"><div slot="foo" /></Child>` has a default group of two
 * whitespace text nodes and no default slot at all, and giving the props object a `children` for it
 * put a key in `Object.keys($props())` that Svelte does not have.
 */
export function filled(group: Given | undefined): boolean {
	if (group === undefined) return false;
	return group.nodes.some(
		(one) => !isNode(one) || one['type'] !== 'Text' || String(one['data'] ?? '').trim() !== '',
	);
}

/**
 * What a component is handed, by the name each part of it arrives under.
 *
 * Read out of `visitors/shared/component.js`. The markup inside a component's tag is not one
 * thing. Every `{#snippet}` directly inside it is hoisted and pushed as a prop of its own under
 * its own name; a child carrying `slot="x"` joins the group of that name; everything left over
 * becomes one function passed as `children`. So a component may write one group and not another,
 * and asking about the tag as a whole cannot tell that from a fault -- which is what
 * `<DropdownMenu.Trigger>` was: markup measured as one group, part of it written, and the
 * arithmetic reporting a contradiction that was never there.
 *
 * Keyed by the child so the walk stays in document order, which is the order the ordinals count in.
 */
export function handedTo(
	file: string,
	tag: string,
	nodes: readonly unknown[],
): ReadonlyMap<unknown, Group> {
	const found = new Map<unknown, Group>();
	const groups = new Map<string, Group>();
	const under = (name: string, at: number): Group => {
		const held = groups.get(name);
		if (held !== undefined) return held;
		const one: Group = {
			at,
			probe: `%%h${identity(file, at)}%%`,
			what: name === 'children' ? `\`<${tag}>\`` : `\`<${tag}>\` as \`${name}\``,
		};
		groups.set(name, one);
		return one;
	};

	for (const child of nodes) {
		if (!isNode(child)) continue;
		if (child['type'] === 'SnippetBlock') {
			const id = child['expression'];
			const name = isNode(id) && typeof id['name'] === 'string' ? id['name'] : '';
			// The body, so the declaration keeps its name and the component still receives the prop.
			// An empty one holds nothing to measure and nothing to relax.
			const at = extent(child['body'])?.[0];
			if (name === '' || at === undefined) continue;
			found.set(child, under(name, at));
			continue;
		}
		// Whitespace and comments are not content: Svelte's analysis lets them sit beside an
		// explicit `{#snippet children}` and refuses anything else with `snippet_conflict`. So they
		// open no group, or the literal planted at the group's head would be the content that
		// conflicts, and every probe of a tag written across lines would fail before it measured.
		if (child['type'] === 'Comment') continue;
		if (child['type'] === 'Text' && String(child['data'] ?? '').trim() === '') continue;
		const at = span(child)?.[0];
		if (at === undefined) continue;
		found.set(child, under(slotOf(child) ?? 'children', at));
	}
	return found;
}

/**
 * What a parameter binds, each name as the expression that reaches it from the argument.
 *
 * The way in, read forward out of Svelte's own `_extract_paths` in `compiler/utils/ast.js`, which
 * is the client transform's answer to the same question. There is a way in to every name a pattern
 * binds, and it is not always a member: a key written `[expr]` or as a literal is an index, a
 * nesting is one way in written after another, and a rest is a call --
 * `exclude_from_object(value, keys)` for an object, `to_array(value).slice(n)` for an array. Both
 * are Svelte's own, carried the way `attributes` is, so the emptying rule and the symbol handling
 * are upstream's rather than reproduced here.
 *
 * A default is written the way JavaScript reads one: taken when the value is `undefined` and only
 * then. A computed key is expanded against what the pattern has bound so far, because JavaScript
 * binds a pattern left to right and `{ length, [length - 1]: last }` reads the one from the other.
 */
export function takenApart(
	pattern: AstNode,
	argument: string,
	expand: Locals['rewrite'],
	what: () => string,
	/**
	 * Where a computed key changes something as it is evaluated -- `[`p${num++}`]` -- what it is
	 * held as, so that the member read and the keys a rest leaves out are the one evaluation
	 * JavaScript makes. Absent, a key is written at each place it is read.
	 */
	hold?: (text: string, at: number) => string,
): Map<string, string> {
	const bound = new Map<string, string>();
	// Bound so far, so a computed key reaches a name written before it in the same pattern.
	const write = (node: unknown): string => expand(node, bound);
	const withDefault = (reached: string, fallback: unknown): string =>
		`(${reached} === undefined ? (${write(fallback)}) : ${reached})`;
	const one = (target: unknown, reached: string): void => {
		if (!isNode(target)) return;
		const type = target['type'];
		if (type === 'Identifier' && typeof target['name'] === 'string') {
			bound.set(target['name'], reached);
			return;
		}
		if (type === 'AssignmentPattern') {
			one(target['left'], withDefault(reached, target['right']));
			return;
		}
		// `let:x={{ a, b }}` parses as an expression and is really a pattern -- Svelte says so in as
		// many words, `shared/component.js` rebuilding it with `b.object_pattern(expression.properties)`
		// and an `@ts-expect-error` beside it. Only the outermost one is rebuilt there, because the
		// printer turns the rest back into source JavaScript reads as a pattern; here the node is
		// walked, so both spellings are read at every depth.
		if (type === 'ObjectPattern' || type === 'ObjectExpression') {
			// The keys a rest leaves out are every key the pattern names, in the order Svelte writes
			// them: a plain name as itself, a literal as its value read as a string, and a computed
			// key as `String(...)` of the expression, which evaluates it a second time.
			const taken: string[] = [];
			for (const property of Array.isArray(target['properties']) ? target['properties'] : []) {
				if (!isNode(property)) continue;
				if (property['type'] === 'RestElement' || property['type'] === 'SpreadElement') {
					one(property['argument'], `$$exclude_from_object(${reached}, [${taken.join(', ')}])`);
					continue;
				}
				if (property['type'] !== 'Property') continue;
				const key = property['key'];
				if (!isNode(key)) refuse(`${what()} has a key this compiler cannot read`);
				const computed = property['computed'] === true;
				const literal = key['type'] === 'Literal';
				if (!computed && key['type'] === 'Identifier' && typeof key['name'] === 'string') {
					taken.push(JSON.stringify(key['name']));
					one(property['value'], `${reached}.${key['name']}`);
					continue;
				}
				const text = write(key);
				const place = span(key)?.[0] ?? 0;
				const once =
					!literal && hold !== undefined && assigned(text).length > 0 ? hold(text, place) : text;
				taken.push(literal ? JSON.stringify(String(key['value'])) : `String(${once})`);
				one(property['value'], `${reached}[${once}]`);
			}
			return;
		}
		if (type === 'ArrayPattern' || type === 'ArrayExpression') {
			// Through `to_array` and not by index. An array pattern destructures by the iterator
			// protocol -- Svelte's server writes `let [a, b] = each_array[i]` and lets the engine do
			// it -- and reading `value[0]` instead is the same answer for an array and no answer at
			// all for anything else: measured, `{#each rows as [a, b]}` over a list of sets wrote
			// `-` where Svelte wrote `x-y`.
			//
			// **Without the count `_extract_paths` passes.** That is the client transform's answer to
			// this question and it is one step away from the server's: `to_array(value, n)` caps an
			// unbounded iterator at `n`, and it reaches that branch through `Symbol.iterator in
			// value`, which throws on a primitive. `{@const [first] = 'ab'}` destructures on the
			// server and threw here. So the call is made the way the branch below it behaves --
			// arrays unchanged, everything else through `Array.from` -- which is the engine's answer
			// for every source but an endless one, and an endless one is not a thing a render ends
			// on either way.
			const elements = Array.isArray(target['elements']) ? target['elements'] : [];
			const listed = `$$to_array(${reached})`;
			for (const [at, element] of elements.entries()) {
				if (!isNode(element)) continue;
				if (element['type'] === 'RestElement') {
					one(element['argument'], `${listed}.slice(${String(at)})`);
					continue;
				}
				one(element, `${listed}[${String(at)}]`);
			}
			return;
		}
		refuse(`${what()} destructures in a way this compiler cannot read: a ${String(type)}`);
	};
	one(pattern, argument);
	return bound;
}

/**
 * Writes over everything in a pattern the render would evaluate, leaving one that binds the same
 * names from a placeholder without reaching for anything.
 *
 * The render takes the pattern apart from `{}` or `[]` and every read of what it binds is a marker
 * already, so nothing the pattern computes is wanted -- and each of these throws or reaches for
 * data the render is not given. A default's value and a computed key become `undefined`; a nested
 * pattern becomes a name, because `{ a: { b } }` over `{}` destructures `undefined` and throws,
 * which is Svelte's own output failing on a placeholder nobody wrote. The name carries `$$`, which
 * Svelte reserves and no author can collide with, and the position it stands at, which no two
 * nestings in one file share.
 */
export function neutralise(pattern: unknown, edits: [number, number, string][], top = true): void {
	if (!isNode(pattern)) return;
	const type = pattern['type'];
	const at = span(pattern);
	if (!top && (type === 'ObjectPattern' || type === 'ArrayPattern')) {
		if (at !== null) edits.push([at[0], at[1], `$$p${String(at[0])}`]);
		return;
	}
	if (type === 'AssignmentPattern') {
		const where = span(pattern['right']);
		if (where !== null) edits.push([where[0], where[1], 'undefined']);
		neutralise(pattern['left'], edits, top);
		return;
	}
	if (type === 'RestElement') {
		neutralise(pattern['argument'], edits, false);
		return;
	}
	if (type === 'ObjectPattern') {
		for (const property of Array.isArray(pattern['properties']) ? pattern['properties'] : []) {
			if (!isNode(property)) continue;
			if (property['type'] === 'RestElement') {
				neutralise(property, edits, false);
				continue;
			}
			if (property['computed'] === true) {
				const where = span(property['key']);
				if (where !== null) edits.push([where[0], where[1], 'undefined']);
			}
			neutralise(property['value'], edits, false);
		}
		return;
	}
	if (type === 'ArrayPattern') {
		for (const element of Array.isArray(pattern['elements']) ? pattern['elements'] : []) {
			neutralise(element, edits, false);
		}
	}
}

/** Writes each expression of an attribute back out in its expanded form, for Svelte to evaluate. */
export function expanded(
	attr: AstNode,
	source: string,
	walk: Walk,
	edits: [number, number, string][],
): void {
	const name = typeof attr['name'] === 'string' ? attr['name'] : '';
	const value = attr['value'];
	if (value === true) return;
	const at = span(attr);
	// The shorthand holds a bare name and nothing else, so the name is written out first.
	if (at !== null && source[at[0]] === '{') edits.push([at[0], at[0], `${name}=`]);
	for (const part of Array.isArray(value) ? value : [value]) {
		if (!isNode(part) || part['type'] !== 'ExpressionTag') continue;
		const where = span(part['expression']);
		if (where === null) continue;
		// The author's own text where the walk bound nothing in it, so that the render runs the
		// author's script whole. See `asWritten`.
		const written = walk.expand(part['expression']);
		edits.push([where[0], where[1], asWritten(part['expression'], written, walk)]);
	}
}

/** Where an element's opening tag closes: the index of its `>`. */
export function closing(source: string, node: AstNode): number {
	const at = span(node);
	let last = at === null ? 0 : at[0];
	for (const one of Array.isArray(node['attributes']) ? node['attributes'] : []) {
		const where = span(one);
		if (where !== null) last = Math.max(last, where[1]);
	}
	const close = source.indexOf('>', last);
	if (close < 0) refuse('an element this compiler cannot read the tag of');
	return close;
}

/** One attribute of an element by name, or undefined. */
function attributeOf(node: AstNode, name: string): AstNode | undefined {
	const attributes = Array.isArray(node['attributes']) ? node['attributes'] : [];
	return attributes.find(
		(one): one is AstNode =>
			isNode(one) && one['type'] === 'Attribute' && String(one['name']).toLowerCase() === name,
	);
}

/** Whether a fragment writes a name out as a value: `{children}`, not `{@render children()}`. */
export function reads(ast: AstNode, name: string): boolean {
	let found = false;
	const step = (one: unknown): void => {
		if (found) return;
		if (Array.isArray(one)) {
			for (const each of one) step(each);
			return;
		}
		if (!isNode(one)) return;
		if (one['type'] === 'ExpressionTag') {
			const held = one['expression'];
			if (isNode(held) && held['type'] === 'Identifier' && held['name'] === name) {
				found = true;
				return;
			}
		}
		for (const value of Object.values(one)) step(value);
	};
	step(ast['fragment']);
	return found;
}

/**
 * Svelte's `DOM_BOOLEAN_ATTRIBUTES`, which `crates/lowering/src/attributes.rs` carries for the
 * runtime and this file needs for the one element whose attributes the render cannot show.
 */
const BOOLEAN = new Set([
	'allowfullscreen',
	'async',
	'autofocus',
	'autoplay',
	'checked',
	'controls',
	'default',
	'defer',
	'disabled',
	'disablepictureinpicture',
	'disableremoteplayback',
	'formnovalidate',
	'indeterminate',
	'inert',
	'ismap',
	'loop',
	'multiple',
	'muted',
	'nomodule',
	'novalidate',
	'open',
	'playsinline',
	'readonly',
	'required',
	'reversed',
	'seamless',
	'selected',
	'webkitdirectory',
]);

/**
 * A `<select value>` and the `<option>`s under it, read out of `renderer.js`.
 *
 * The renderer drops the select's `value` and keeps it aside; each option then compares its own
 * value against it as it closes -- `includes` where the select is `multiple` and the value an
 * array, `===` otherwise -- and writes ` selected=""` after its attributes when they match. An
 * option's own value is its `value` attribute, or the single expression that is its content,
 * which Svelte's analysis marks so a number stays a number, or otherwise its rendered text.
 *
 * So the select's value is cut from the render, which writes nothing for it, and every option
 * gets a boolean `selected` decided by the comparison, as a hole planted where the renderer
 * writes it: last, before the `>`. Returns what the children walk under.
 */
/**
 * Whether some `<option>` under this `<select>` writes no `value` and holds a body this walk cannot
 * read as one value.
 *
 * `renderer.option` compares against the rendered body where the attribute is absent, and the walk
 * can read that body only where it is text, or one expression. A `{@render}` in it is bytes the
 * render writes and nothing here can name.
 */
export function unreadable(node: AstNode): boolean {
	let found = false;
	const step = (one: unknown): void => {
		if (found) return;
		if (Array.isArray(one)) {
			for (const each of one) step(each);
			return;
		}
		if (!isNode(one)) return;
		if (one['name'] === 'option' && one['type'] === 'RegularElement') {
			if (attributeOf(one, 'value') === undefined) {
				const fragment = one['fragment'];
				const nodes = isNode(fragment) && Array.isArray(fragment['nodes']) ? fragment['nodes'] : [];
				const [only] = nodes;
				const single = nodes.length === 1 && isNode(only) && only['type'] === 'ExpressionTag';
				const text = nodes.every((child) => isNode(child) && child['type'] === 'Text');
				if (!single && !text) found = true;
			}
		}
		for (const value of Object.values(one)) step(value);
	};
	step(node['fragment']);
	return found;
}

export function selection(
	node: AstNode,
	source: string,
	expand: Locals['rewrite'],
	holes: Hole[],
	edits: [number, number, string][],
	selecting: Walk['selecting'],
	skipped: Set<unknown>,
	/** Keys the spread pass must leave out of the object it builds, lowercased. */
	dropped: Set<string>,
	/** Whether a value is the same every request, so the render's own comparison is every one's. */
	inert: (text: string) => boolean,
): Walk['selecting'] {
	const tag = node['name'];
	if (tag === 'select') {
		// `renderer.select()` takes both off the attributes, writes neither, and compares the
		// options against `value === undefined ? defaultValue : value`.
		//
		// A spread carries either of them exactly as a written attribute does, because the renderer
		// reads them off the **merged** attributes. So the tag is read in source order and the last
		// of each name wins, which is what building one object out of the parts does -- and both
		// have to come off the tag, or Svelte's own `select()` does the comparison a second time
		// over what was left. Measured before either was: `<select {...{ defaultValue: 'b' }}
		// defaultValue="a">` marked both options, ours from the attribute and Svelte's own from the
		// spread.
		//
		// Taking one out of a spread means rewriting the object, which is only possible where its
		// keys can be listed. Where they cannot, the value is the request's and so is the option
		// that carries it, and that is refused by name.
		const listed = Array.isArray(node['attributes']) ? node['attributes'] : [];
		// Where a spread is on the tag, the spread pass rewrites the whole run of attributes and
		// two passes writing over the same span is an error. So the names go into `dropped` and the
		// edits are that pass's; without a spread they are this one's.
		const spreading = listed.some((one) => isNode(one) && one['type'] === 'SpreadAttribute');
		/** Kept until the tag is known to be one this walk models, since taking it off is an edit. */
		const taken: AstNode[] = [];
		const each = (attribute: AstNode): string => {
			const written = valueExpression(attribute, source, expand);
			if (written === null) {
				refuse(
					'`<select value>` mixing text and an expression is not handled yet: the options ' +
						'compare against the joined string',
				);
			}
			taken.push(attribute);
			return written;
		};
		let chosen: string | undefined;
		let held: string | undefined;
		/** What `!!select_attrs.multiple` reads, as an expression rather than as a syntax fact. */
		let several = 'false';
		for (const one of listed) {
			if (!isNode(one)) continue;
			if (one['type'] === 'SpreadAttribute') {
				const grown = expand(one['expression']);
				const entries = objectEntries(grown);
				// Keys this pass can list are read as written, which keeps the value a literal where the
				// object is one. Where it cannot list them the three names are read off the object
				// instead, which is what `renderer.select` does: `const { value, defaultValue, ...rest }
				// = attrs`, so a key the object does not carry is `undefined` there and here. The
				// select takes charge either way, because an object whose keys nobody can list may
				// carry one and the comparison cannot be left half to the render.
				//
				// **A spread only overwrites the keys it has.** `{ value: v, ...other }` keeps `v`
				// where `other` has no `value`, so reading the key off the object unconditionally
				// wrote `undefined` over a value the tag had already given: measured on
				// `select-multiple-spread-and-bind`, whose `bind:value` came before `{...other}` and
				// lost to an object with neither key in it.
				if (entries === null) {
					chosen = merges(grown, 'value', chosen);
					held = merges(grown, 'defaultValue', held);
					several = merges(grown, 'multiple', several);
					continue;
				}
				for (const [key, value] of entries) {
					const name = key.toLowerCase();
					if (name === 'value') chosen = `(${value})`;
					else if (name === 'defaultvalue') held = `(${value})`;
					else if (name === 'multiple') several = `(${value})`;
				}
				continue;
			}
			if (one['type'] !== 'Attribute' || typeof one['name'] !== 'string') continue;
			const name = one['name'].toLowerCase();
			if (name === 'value') chosen = each(one);
			else if (name === 'defaultvalue') held = each(one);
			// `select()` reads `renderer.local.multiple = !!select_attrs.multiple`, which is the
			// value rather than the attribute being written: `multiple={false}` is not multiple.
			// Taken off the tag rather than off `taken`, since it stays where it was written.
			else if (name === 'multiple') several = valueExpression(one, source, expand) ?? 'true';
		}
		if (chosen === undefined && held === undefined) return undefined;
		const written =
			chosen === undefined
				? String(held)
				: held === undefined
					? chosen
					: `(${chosen} === undefined ? ${held} : ${chosen})`;
		// `renderer.option` compares against the **rendered body** where the option writes no `value`
		// of its own, and a body this walk cannot read as one value is a body it cannot compare. The
		// comparison is the render's to make in that case: nothing here varies with the request, so
		// the bytes the render writes are the bytes every request gets, and the way to leave it to
		// the render is to leave the tag alone -- both names have to stay on it, or `select()` sees
		// neither. Only where nothing varies; where the value is the request's the option is refused
		// by name as before.
		if (inert(written) && unreadable(node)) return undefined;
		for (const attribute of taken) {
			if (!spreading) {
				const at = span(attribute);
				if (at !== null) edits.push([at[0], at[1], '']);
			}
			skipped.add(attribute);
		}
		if (spreading) {
			dropped.add('value');
			dropped.add('defaultvalue');
		}
		// `select()` maps `multiple === ''` to `true` before reading it, because `multiple=""` is a
		// present boolean attribute in markup and `!!''` is false. Folded where the value is written,
		// and written out where it comes off an object nobody can list the keys of.
		const many =
			several === '""'
				? 'true'
				: several === 'true' || several === 'false'
					? several
					: `((${several}) === '' ? true : (${several}))`;
		return { value: written, multiple: many };
	}
	if (tag !== 'option') return selecting;

	// Every `<option>` goes through `renderer.option` -- `is_option_special` in `RegularElement.js`
	// is the name alone, with no `<select>` around it required -- so its attributes are written by
	// `attributes()` rather than folded into the template. That helper writes a boolean attribute
	// as `name=""` whatever its value, so a marker planted as one never comes back and the render
	// showed `disabled=""` on every item of an each. It is a decision, and it takes the shape
	// `selected` takes below: the marker rides in an attribute of its own, planted where the
	// boolean one stood so the order the helper writes in is kept, and the decision owns the whole
	// of that attribute -- the space, the name, the value.
	for (const attribute of Array.isArray(node['attributes']) ? node['attributes'] : []) {
		if (!isNode(attribute) || attribute['type'] !== 'Attribute') continue;
		const name = typeof attribute['name'] === 'string' ? attribute['name'].toLowerCase() : '';
		if (!BOOLEAN.has(name)) continue;
		const parts = Array.isArray(attribute['value']) ? attribute['value'] : [attribute['value']];
		const [only] = parts;
		// Written as text or as nothing, the helper's answer is the same every request and the
		// render already shows it.
		if (parts.length !== 1 || !isNode(only) || only['type'] !== 'ExpressionTag') continue;
		const where = span(attribute);
		if (where === null) continue;
		const index = holes.length;
		holes.push({
			index,
			expression: '',
			raw: false,
			choice: { tests: [`!!(${expand(only['expression'])})`], outcomes: ['', ` ${name}=""`] },
		});
		edits.push([
			where[0],
			where[1],
			`data-seam-boolean-${String(index)}={${JSON.stringify(sentinel(index))}}`,
		]);
		skipped.add(attribute);
	}

	if (selecting === undefined) return selecting;

	// `renderer.option` compares against the rendered body and takes the attributes' `value` over it
	// where they have one: `if (has_own_property.call(attrs, 'value')) value = attrs.value`. A spread
	// carries the key exactly as a written attribute does, so the run is read in source order and
	// the last of them wins, the way a select's is.
	let spread: string | undefined;
	for (const one of Array.isArray(node['attributes']) ? node['attributes'] : []) {
		if (!isNode(one) || one['type'] !== 'SpreadAttribute') continue;
		const grown = expand(one['expression']);
		const entries = objectEntries(grown);
		if (entries === null) {
			spread = merges(grown, 'value', spread);
			continue;
		}
		for (const [key, value] of entries) if (key.toLowerCase() === 'value') spread = `(${value})`;
	}
	const own = attributeOf(node, 'value');
	let compared: string | null;
	if (own !== undefined) {
		compared = valueExpression(own, source, expand);
	} else if (spread !== undefined) {
		compared = spread;
	} else {
		const fragment = node['fragment'];
		const nodes = isNode(fragment) && Array.isArray(fragment['nodes']) ? fragment['nodes'] : [];
		const [only] = nodes;
		if (nodes.length === 1 && isNode(only) && only['type'] === 'ExpressionTag') {
			compared = `(${expand(only['expression'])})`;
		} else if (nodes.every((child) => isNode(child) && child['type'] === 'Text')) {
			compared = JSON.stringify(
				nodes
					.map((child) => String((child as AstNode)['raw'] ?? (child as AstNode)['data'] ?? ''))
					.join(''),
			);
		} else {
			compared = null;
		}
	}
	if (compared === null) {
		refuse(
			'an `<option>` under a `<select value>` whose own value is mixed content is not handled ' +
				'yet: the renderer compares against the rendered text, which is one value once written',
		);
	}
	const { value, multiple } = selecting;
	// `select()` puts `!!select_attrs.multiple` on the renderer and `option()` reads it, so it is a
	// value like the select's own. The two literal cases keep the shape they had, since every
	// derivation this compiler has recorded was written with them.
	const test =
		multiple === 'false'
			? `(${value}) === (${compared})`
			: multiple === 'true'
				? `(Array.isArray(${value}) ? (${value}).includes(${compared}) : (${value}) === (${compared}))`
				: `((${multiple}) && Array.isArray(${value}) ? (${value}).includes(${compared}) : (${value}) === (${compared}))`;
	// An option's attributes are written by the runtime helper rather than folded into the
	// template, and the helper writes a boolean attribute as `=""` whatever its value, so a marker
	// planted as the value never comes back. It is a decision instead, the way a `class:` is: the
	// marker rides in an attribute of its own, written last, and the decision owns the whole of
	// that attribute -- the space, the name, the value -- and replaces it with what the renderer
	// writes there: nothing, or ` selected=""`. The outcomes need no render to be known.
	const index = holes.length;
	holes.push({
		index,
		expression: '',
		raw: false,
		choice: { tests: [test], outcomes: ['', ' selected=""'] },
	});
	const close = closing(source, node);
	edits.push([close, close, ` data-seam-selected={${JSON.stringify(sentinel(index))}}`]);
	return selecting;
}

/** An attribute's value as one expression: a literal for text, the expression for one, else null. */
/**
 * A key read off a merged object the way a spread merges it: only where the object has it.
 *
 * `{ value: v, ...other }` keeps `v` where `other` has no `value`, so reading the key off the
 * object unconditionally writes `undefined` over a value the tag had already given.
 */
export function merges(object: string, key: string, before: string | undefined): string {
	const named = JSON.stringify(key);
	const held = before ?? 'undefined';
	return `(Object.prototype.hasOwnProperty.call(${object}, ${named}) ? (${object})[${named}] : ${held})`;
}

export function valueExpression(
	attribute: AstNode,
	source: string,
	expand: Locals['rewrite'],
): string | null {
	const value = attribute['value'];
	if (value === true) return 'true';
	const parts = Array.isArray(value) ? value : [value];
	if (parts.every((part) => isNode(part) && part['type'] === 'Text')) {
		return JSON.stringify(parts.map((part) => String((part as AstNode)['data'] ?? '')).join(''));
	}
	const [only] = parts;
	if (parts.length === 1 && isNode(only) && only['type'] === 'ExpressionTag') {
		return `(${expand(only['expression'])})`;
	}
	return null;
}

/**
 * A binding the server writes as the element's content: `bind:innerHTML`, unescaped, and
 * `bind:textContent`, `bind:innerText` and a textarea's `bind:value`, escaped.
 *
 * `RegularElement.js`: the binding's expression is the body, written when truthy and the
 * children otherwise, with no anchor around either -- which is not `{@html}`, whose anchors the
 * client reads. With no children the body is the whole content: `value || ''` raw for
 * `innerHTML`, and `{value}` for the rest, which `unbind.ts` writes. With children it is a
 * decision between the value and them, and it is written as the if it is, marked bare so that
 * the anchors the render carries stay out of the bytes. A textarea takes no block, so there the
 * children are the text they can only be and the choice is one expression.
 *
 * What is tested is what Svelte tests: the value itself for `innerHTML`, and `$.escape(value)`
 * for the rest, which is empty exactly when `String(value ?? '')` is.
 */
export function contents(
	node: AstNode,
	walk: Walk,
	holes: Hole[],
	edits: [number, number, string][],
	skipped: Set<unknown>,
): number | undefined {
	const { source, expand, blocks, within, stream } = walk;
	const tag = typeof node['name'] === 'string' ? node['name'] : '';
	const attributes = Array.isArray(node['attributes']) ? node['attributes'] : [];
	const binding = attributes.find(
		(one): one is AstNode =>
			isNode(one) &&
			one['type'] === 'BindDirective' &&
			(one['name'] === 'innerHTML' ||
				one['name'] === 'textContent' ||
				one['name'] === 'innerText' ||
				(one['name'] === 'value' && tag === 'textarea')),
	);
	if (binding === undefined) return;
	const raw = binding['name'] === 'innerHTML';
	const fragment = node['fragment'];
	const nodes = isNode(fragment) && Array.isArray(fragment['nodes']) ? fragment['nodes'] : [];
	const at = span(binding);
	const close = closing(source, node);
	// A self-closing tag has no content and the pair is written out around the value, which is the
	// same answer `unbind.ts` already gave a `bind:textContent` written that way and this arm did
	// not: `<editor contenteditable bind:innerHTML={name} />` is `runtime-legacy/
	// binding-contenteditable-html`, and Svelte renders it `<editor ...>` -- the value -- `</editor>`
	// whichever way the author closed it. It was refused for a tag this compiler cannot read, which
	// was never what was wrong. The sample sat in the skips until the configs were read.
	const opened = opening(source, node);
	if (at === null || opened === null)
		refuse(`\`bind:${String(binding['name'])}\` on a tag this compiler cannot read`);
	const value = `(${expand(binding['expression'])})`;
	skipped.add(binding);
	edits.push([at[0], at[1], '']);

	if (nodes.length === 0) {
		const index = holes.length;
		holes.push({ index, expression: `(${value} || '')`, raw: true });
		edits.push([opened.from, opened.to, `${opened.before}${sentinel(index)}${opened.after}`]);
		return;
	}

	if (tag === 'textarea') {
		// Its children are text and nothing else once Svelte has looked at them: anything dynamic
		// is moved into a `value` attribute by `2-analyze/visitors/RegularElement.js`, which a
		// binding beside it then contradicts.
		const parts: string[] = [];
		for (const child of nodes) {
			if (!isNode(child) || child['type'] !== 'Text') {
				refuse(
					'a `<textarea>` with a `bind:value` and children that are not text is not handled ' +
						'yet: Svelte moves such children into a `value` attribute',
				);
			}
			parts.push(JSON.stringify(String(child['data'] ?? '')));
		}
		const index = holes.length;
		holes.push({
			index,
			expression: `(String(${value} ?? '') !== '' ? ${value} : ${parts.join(' + ')})`,
			raw: false,
		});
		const whole = span(node);
		const end = whole === null ? -1 : source.lastIndexOf('</', whole[1]);
		if (end < 0) refuse('a `<textarea>` this compiler cannot read the end of');
		edits.push([close + 1, end, sentinel(index)]);
		return;
	}

	const test = raw ? value : `String(${value} ?? '') !== ''`;
	const index = blocks.length;
	blocks.push({
		index,
		kind: 'if',
		stream,
		expression: test,
		tests: [test],
		item: null,
		counter: null,
		alternate: true,
		within: [...within],
		bare: true,
	});
	const hole = holes.length;
	holes.push({ index: hole, expression: value, raw });
	const whole = span(node);
	const end = whole === null ? -1 : source.lastIndexOf('</', whole[1]);
	if (end < 0)
		refuse(
			`an element with \`bind:${String(binding['name'])}\` this compiler cannot read the end of`,
		);
	chose(
		walk,
		edits,
		close + 1,
		close + 1,
		index,
		0,
		`{#if true}${sentinel(hole)}{:else}`,
		`{#if false}${sentinel(hole)}{:else}`,
	);
	const [from, to, text] = stamped({ ...walk, parent: tag }, index, walk.source, end);
	edits.push([from, to, `{/if}${text}`]);
	// The children are the else, and the caller walks them within it.
	return index;
}
