/**
 * What a tag's attributes select: the props a call site passes, the values a marker can and
 * cannot stand in, and the groups a caller's markup is handed to a child in. See spec/refusals.md.
 */
import { type Locals, objectEntries } from '@seam-js/ast';
import { type AstNode, isNode, refuse, span } from './node.ts';
import { sentinel } from './sentinel.ts';
import type { Hole } from './shape.ts';
import { opening } from './unbind.ts';
import { chose } from './branches.ts';
import { stamped } from './stamps.ts';
import type { Walk } from './walk-types.ts';
import { closing } from './handed.ts';

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
