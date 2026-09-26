/**
 * Attributes: classes, styles, spreads, directives, elements and the tags the server writes.
 * Cases `skeleton.test.ts` runs; each carries the payloads its shape turns on. See spec/refusals.md.
 */
import { type Case, PROPS } from './case.ts';

export const cases: Case[] = [
	{
		// `{n}` is `n={n}`, and the braces of the short form hold a bare name and nothing else. The
		// marker that goes there is not one, so this used to stop inside Svelte's parser with
		// `attribute_empty_shorthand` -- an error about the author's own file, saying something
		// untrue about it. See spec/refusals.md.
		name: 'a shorthand attribute',
		source:
			'<script>let { data } = $props(); const n = data.a; const cls = data.b</script>' +
			'<b {n} class={cls}>x</b>',
		data: [
			{ a: 'v', b: 'c' },
			{ a: '', b: null },
		],
	},
	{
		// Every branch of `to_class`, which is what a `class:` compiles to. The payloads matter more
		// here than anywhere else: a directive that is falsy does not leave the class alone, it
		// removes its own name from it, and `on` below is in the static class on purpose. When
		// everything cancels there is no class attribute at all, which is the second payload.
		name: 'a class directive, both ways',
		source: `${PROPS}<p class="on" class:on={data.f}>x</p>`,
		data: [{ f: true }, { f: false }, { f: 0 }, { f: 'yes' }],
	},
	{
		// No class attribute to work with. Svelte's analysis invents an empty one and puts it after
		// every attribute that was written, so this also pins where it lands.
		name: 'a class directive with no class attribute',
		source: `${PROPS}<p id="i" class:on={data.f}>x</p>`,
		data: [{ f: true }, { f: false }],
	},
	{
		name: 'two class directives on one element',
		source: `${PROPS}<p class="a" class:on={data.f} class:off={data.g}>x</p>`,
		data: [
			{ f: true, g: true },
			{ f: true, g: false },
			{ f: false, g: true },
			{ f: false, g: false },
		],
	},
	{
		// The scoping hash is written inside the class attribute, between the value and the
		// directives, so a decision over the attribute has to carry it. It is read off the render
		// rather than reproduced: three places that hash a filename is two too many.
		name: 'a class directive in a scoped component',
		source: `${PROPS}<p class="a" class:on={data.f}>x</p><style>.a{color:red}</style>`,
		data: [{ f: true }, { f: false }],
	},
	{
		// The one entry in Svelte's replacement table: `true` is `"yes"` and `false` is `"no"`,
		// because `translate="false"` means yes. A literal is folded by Svelte in the render, and a
		// value decided per request goes through the injector's copy of the table.
		name: 'translate',
		source: `${PROPS}<p translate={data.f}>{data.a}</p><i translate={true}>x</i><u translate="no">y</u>`,
		data: [
			{ f: true, a: 'x' },
			{ f: false, a: 'x' },
			{ f: 'yes', a: 'x' },
			{ f: null, a: 'x' },
		],
	},
	{
		// Text beside an expression is one value, joined the way `build_attribute_value` joins it:
		// a template with `$.stringify` around each expression, so null writes nothing and the
		// declaration `width: px;` is still written.
		name: 'style directives mixing text and expressions',
		source: `${PROPS}<p style:width="{data.a}px" style:color="{data.c}">x</p>`,
		data: [
			{ a: 10, c: 'red' },
			{ a: null, c: '' },
			{ a: 0, c: 'blue' },
		],
	},
	{
		// The renderer drops the select's value and writes ` selected=""` on the option that matches
		// it: `===` against the option's own value -- its attribute, or the one expression that is
		// its content, or its text -- and `includes` where the select is `multiple` and the value an
		// array. A bound value reads the same way. See spec/refusals.md.
		name: 'a select with a value',
		source:
			'<script>let { data } = $props(); let s = $state(data.s)</script>' +
			'<select value={data.s}><option value="a">A</option><option>b</option>' +
			'<option value={data.o}>{data.o}</option>{#each data.xs as x}<option value={x}>{x}</option>{/each}</select>' +
			'<select multiple value={data.m}><option value="a">A</option><option value="b">B</option></select>' +
			'<select bind:value={s}><option>{data.n}</option><option value="1">one</option></select>',
		data: [
			{ s: 'a', o: 'o', xs: ['x', 'y'], m: ['a', 'b'], n: 1 },
			{ s: 'y', o: 'y', xs: ['y'], m: 'b', n: 2 },
			{ s: 1, o: 'o', xs: [], m: [], n: 1 },
			{ s: null, o: null, xs: ['x'], m: null, n: null },
		],
	},
	{
		// Two of them and no `style` attribute, which is the shape that could not be independent
		// declarations: the result is trimmed, so whichever is present first loses its leading
		// space. Enumerated instead, each outcome built by calling `attr_style`, and each carrying
		// markers of its own so a value in half the outcomes is a hole consumed once.
		name: 'two style directives',
		source: `${PROPS}<span style:width={data.w} style:margin-top={data.m}></span>`,
		data: [
			{ w: '1px', m: '2px' },
			{ w: null, m: '2px' },
			{ w: '1px', m: null },
			{ w: null, m: null },
			// Neither is truthy and both are written: `to_style` asks whether the value is null or
			// the empty string, not whether it is falsy.
			{ w: 0, m: '' },
		],
	},
	{
		// A `style` attribute beside a directive is not passed through: the attribute is
		// reassembled, so this one is re-parsed and re-emitted, and `width` disappears out of it
		// because a directive names it.
		name: 'a style directive beside a style attribute',
		source: `${PROPS}<span style="width:9px;color:red" style:width={data.w}></span>`,
		data: [{ w: '1px' }, { w: null }],
	},
	{
		name: 'an important style directive, and a written one',
		source: `${PROPS}<span style:color="red" style:width|important={data.w}></span>`,
		data: [{ w: '1px' }, { w: null }],
	},
	{
		// `prepare_element_spread` returns one tuple -- `[object, css_hash, classes, styles, flags]` --
		// and both paths are built from it: an ordinary element becomes `$.attributes(object, ...tail)`
		// and a `<select>` becomes `$$renderer.select(object, fn, ...tail)`. Same object, same tail,
		// with the children function between them. Reading the call by its name alone is what refused
		// a select whose run this compiler has to write itself.
		name: 'a spread on a `<select>` the request decides',
		source:
			`${PROPS}<select {...{ value: data.v, 'data-x': data.a }} defaultValue="a">` +
			'<option value="a">A</option><option value="b">B</option></select>',
		data: [
			{ v: 'a', a: 'x' },
			{ v: 'b', a: '' },
		],
	},
	{
		// The same over an object nobody can list the keys of, which is what makes the merge visible:
		// a spread only overwrites the keys it has, so `{ value: v, ...other }` keeps `v` where
		// `other` has none. `select()` reads `multiple` off the merged object too, and maps a written
		// `multiple=""` to `true`, since `!!''` is false and a present boolean attribute is not.
		name: 'a spread on a `<select>` whose keys the request decides',
		source:
			`${PROPS}<select value={data.v} {...data.r}>` +
			'<option value="a">A</option><option value="b">B</option></select>',
		data: [
			{ v: 'a', r: {} },
			{ v: 'a', r: { value: 'b' } },
			{ v: 'a', r: { multiple: '', value: ['a', 'b'] } },
		],
	},
	{
		// `ClassBody.js` answers each field from `analysis.classes`: `$state` and `$state.raw` are
		// visited in place, where `CallExpression.js` returns the argument, and `$derived` becomes a
		// backing property holding `$.derived(() => e)` beside a getter that calls it. This pass read
		// the declarations a script's statements make and not a class body, so the rune survived
		// substitution and reached the evaluator as `$state is not defined`.
		//
		// A getter rather than a field, which is the shape Svelte gives it and the laziness the thunk
		// buys: a field initialiser runs at construction, before a field written after it exists.
		name: 'a class field written with a rune',
		source:
			'<script>let { data } = $props();' +
			' class Held { n = $state.raw(2); twice = $derived(this.n * 2);' +
			' by = $derived.by(() => this.n + 1) }' +
			' const held = new Held();</script>' +
			'<p>{held.n + data.a}|{held.twice + data.a}|{held.by + data.a}</p>',
		data: [{ a: 'x' }, { a: '' }],
	},
	{
		// `renderer.option` compares against the rendered body and takes the attributes' `value` over
		// it where they have one: `if (has_own_property.call(attrs, 'value')) value = attrs.value`. A
		// spread carries the key exactly as a written attribute does.
		name: 'an option whose value comes off a spread',
		source:
			`${PROPS}<select value={data.v}>` +
			'<option {...{ value: \'a\' }}>A</option><option value="b">B</option></select>',
		data: [{ v: 'a' }, { v: 'b' }],
	},
	{
		// The stamp that says which block just closed is a sibling of the author's own markup, and
		// Svelte's CSS analysis walks siblings: `get_possible_element_siblings` stops at the first
		// element it meets, so a `<template>` between two of them made `.a + .b` stop matching and
		// **both lost their scoping class**. Bare text is not an element and the walk steps over it,
		// which is why it is the carrier wherever text is writable. A `@keyframes` rule is here
		// because it scopes every element in the component, which puts a class on a `<template>`
		// carrier and is what the assembler has to read past. See `carrier()`.
		name: 'a stamp beside markup the stylesheet relates',
		source:
			`${PROPS}<div>{#if data.f}<i class="a">{data.a}</i>{/if}<b class="b">y</b></div>` +
			'<style>.a + .b { color: red }</style>',
		data: [
			{ f: true, a: 'x' },
			{ f: false, a: '<&' },
		],
	},
	{
		// `element()` writes an empty comment, then the tag and its attributes, then the children,
		// another empty comment and a closing tag unless the tag is void, then a third. The
		// attributes and the children are the bytes a written element would produce, because the
		// namespace and the case rules are read off the node rather than off the value -- so the
		// render is given a stand-in tag and only what the tag decides is left to the request.
		name: 'svelte:element',
		source: `${PROPS}<svelte:element this={data.tag} id={data.i}>x{data.a}</svelte:element>`,
		data: [
			{ tag: 'h2', i: 'q', a: 'A' },
			// Void: no children and no closing tag.
			{ tag: 'br', i: 'q', a: 'A' },
			// Raw text: children, and no empty comment before the closing tag.
			{ tag: 'title', i: 'q', a: 'A' },
			// Nothing at all between the two comments.
			{ tag: null, i: 'q', a: 'A' },
		],
	},
	{
		// An element carrying a spread does not write its attributes one at a time: every attribute
		// and every spread on it are merged into one object and handed to `$.attributes`, which
		// walks the object's keys at request time. Which keys those are is the only thing that
		// cannot be known here, so the marker stands for the whole run and the expression behind it
		// is that same call -- with the object rebuilt from the source and every other argument
		// taken verbatim from what Svelte compiled.
		name: 'a spread on an element',
		source: `${PROPS}<div {...data.r} id={data.i}>x{data.t}</div>`,
		data: [
			{ r: { a: '1', title: 'T' }, i: 'q', t: 'T' },
			{ r: {}, i: null, t: '' },
			// Escaping, a boolean name, a function and a key the writer skips, all Svelte's rules.
			{ r: { 'data-x': '<&"', hidden: true, onclick: () => {}, $$weird: 1 }, i: 'z', t: 'U' },
		],
	},
	{
		// The flags an element decides: an input maps `defaultValue`, a custom element keeps the
		// case of its attribute names. Neither is worked out here; both come out of the call.
		name: 'a spread on an input and on a custom element',
		source: `${PROPS}<input {...data.r} /><my-el {...data.r}>x</my-el>`,
		data: [{ r: { defaultValue: 'd', dataFoo: 'v' } }, { r: { value: 'v', disabled: true } }],
	},
	{
		name: 'raw html',
		source: `${PROPS}<p>{@html data.a}</p>`,
		data: [{ a: '<b>x</b>' }, { a: '' }],
	},
	{
		// The scoped class is a hash of the filename relative to `rootDir`, so this also pins that
		// the render pass passes one. What it does not pin is that the client build passes the same
		// one; that is `pkgs/plugin`, where the two halves are held against each other.
		name: 'a scoped style',
		source: `${PROPS}<p class="x">{data.a}</p><style>.x{color:red}</style>`,
		data: [{ a: 'v' }],
	},
	{
		// `build_inline_component` merges a spread with `$.spread_props` in source order, so a
		// component the walk could not enter still needs the object itself, with the request's
		// values standing in it. A marker is a string and spreading a string spreads its characters,
		// so what stands in has to be one marker per leaf -- the same reading an attribute's object
		// value already gets.
		name: 'a spread on a component the walk could not enter',
		// The child is one the walk cannot enter: it assigns a name after declaring it and the markup
		// reads that name, which is a program per request. `$props()` bound to a name is entered now,
		// being the object the call site passed, so it is no longer the shape to reach for here.
		beside: {
			Gate: '<script>let { a, b } = $props(); let c = a; c = b;</script><b>{c}{a}{b}</b>',
		},
		source:
			"<script>import Gate from './Gate.svelte'; let { data } = $props();</script>" +
			'<Gate {...{ a: data.a, b: "x" }} />',
		data: [{ a: 'v' }, { a: '<&' }],
	},
	{
		// `renderer.select` in `internal/server/renderer.js` destructures `{ value, defaultValue }`
		// off the **merged** attributes, writes neither, and compares every option against
		// `value === undefined ? defaultValue : value`. A spread carries either of them exactly as a
		// written attribute does, so the tag is read in source order and the last of each name wins.
		// Both have to come off, or Svelte does the comparison a second time over what was left:
		// measured on `<select {...{ defaultValue: 'b' }} defaultValue="a">`, which selected both
		// options when only the attribute was taken.
		name: 'a spread on a `<select>` carrying the value the options compare against',
		source:
			`${PROPS}<p>{data.a}</p><select {...{ defaultValue: 'b' }}>` +
			'<option value="a">A</option><option value="b">B</option></select>' +
			`<select {...{ defaultValue: 'b' }} defaultValue="a">` +
			'<option value="a">A</option><option value="b">B</option></select>' +
			`<select {...{ value: 'b', defaultValue: 'a' }}>` +
			'<option value="a">A</option><option value="b">B</option></select>',
		data: [{ a: 'x' }],
	},
	{
		// `to_style` builds one string from the written value and the directives, dropping a
		// declaration in the value whose name a directive also names. So which bytes exist is
		// decided by that string, and a marker cannot stand in it. Where the string is the same for
		// every request the render is the one that has it, and the whole run is left as written for
		// Svelte's own `to_style` to build -- which is what a spread of constants already gets.
		name: 'a `style:` beside a `style` the request does not decide',
		source:
			'<script>let { data } = $props(); const paint = () => "color: green";</script>' +
			'<p style:color={"red"} style={paint()}>{data.a}</p>',
		data: [{ a: 'v' }],
	},
	{
		// And where the string is the request's, the whole run is `build_attr_style`'s own call
		// carried, the way `class={expr}` beside a directive already is: `$.attr_style(value,
		// directives)`, one call whose result is the attribute or nothing. Simpler than the class
		// one, which has a scoping hash to read back off the render, and `attr_style` has none. The
		// `!important` bag is a second object beside the first, which is the shape `to_style` reads.
		// Payloads for what `to_style` decides: a value whose declaration a directive drops, an
		// empty one, and a nullish directive that writes no declaration at all.
		name: 'a `style:` beside a `style` the request decides',
		source: `${PROPS}<p style:color={data.c} style:margin|important={data.m} style={data.s}>x</p>`,
		data: [
			{ c: 'red', m: '1em', s: 'color: blue; border: 1px solid' },
			{ c: null, m: null, s: '' },
			{ c: 'green', m: '0', s: 'padding: 2px' },
		],
	},
	{
		// `build_element_attributes` has an arm for a spread, an attribute, a `class:`, a `style:` and
		// an attachment, and nothing else: a `use:`, a `transition:` and an `on:` fall past all of
		// them and write nothing. So a spread beside one merges exactly what it would have merged
		// without it, and the shorthand is the variable of that name -- `build_attr_style` writes
		// `b.id(directive.name)`, read from just past `style:` in the source, the same way the pass
		// that has no spread beside it reads one.
		name: 'a client-only directive and a `style:` shorthand beside a spread',
		source:
			'<script>let { data } = $props(); const focus = () => {}; const color = "red";</script>' +
			'<input {...{ name: data.a }} use:focus onfocus={() => {}} style:color />',
		data: [{ a: 'v' }],
	},
	{
		// `<svelte:element this="svg">` is a quoted literal, so its span sits inside the quotes: the
		// text there is the tag itself rather than an expression naming it, and the stand-in the
		// render is given has to replace the quotes too. Read as an expression it became the
		// identifier `svg`; written inside the quotes it made `this=""seam-el0""`, which Svelte
		// will not parse.
		name: 'a `<svelte:element>` whose tag is written as a quoted literal',
		source: `${PROPS}<svelte:element this="span">{data.a}</svelte:element>`,
		data: [{ a: 'v' }],
	},
	{
		// A `class:` run whose value and every directive vary with nothing the request decides is
		// left exactly as written, and Svelte's own `attr_class` builds it in the render. Enumerated
		// instead, the value had to survive being a derivation, and a `getContext` in one cannot:
		// it asks the component being rendered, which is where the render evaluates it and a
		// derivation never is. `style:` has to answer the same question the same way, or one run is
		// written out here and the other left to the render and the two attributes come out in the
		// wrong order. `runtime-legacy/context-api` is the vendored shape.
		name: 'a `class:` and a `style:` the request does not decide',
		source:
			"<script>let { data } = $props(); const held = { v: true, c: 'red' };</script>" +
			'<p style:color="red" class:foo={true}>a</p>' +
			'<b class:on={held.v} style:color={held.c}>b</b><i>{data.a}</i>',
		data: [{ a: 'q' }],
	},
	{
		name: 'markup that is inert on the server',
		beside: { Quiet: '<script>let { v } = $props();</script><i>{v}</i>' },
		source:
			"<script>import Quiet from './Quiet.svelte'; function act() {} let { data } = $props()</script>" +
			'<svelte:window /><svelte:body /><div use:act onclick={() => {}} {@attach act} {@attach data.g}>{data.a}</div>' +
			'<Quiet v={data.a} {@attach act} />{@debug data}',
		data: [{ a: 'v', g: null }],
	},
	{
		// A class written as an expression, on an element the stylesheet could match. Svelte scopes
		// the element when it cannot read what the class could be, and appends the hash; a marker
		// or a constant written there is a literal it can read, and the hash went missing. What is
		// written into a class value is shielded from the analysis. See `Walk.classValue`.
		name: 'a class expression on a styled element',
		source:
			`${PROPS}<script>const fixed = 'k'</script>`.replace('</script><script>', '; ') +
			'<p class={data.a}>x</p><i class={fixed}>y</i><b class="{data.a} z">w</b>' +
			'<style>.on { color: red } .k { color: blue }</style>',
		data: [{ a: 'on' }, { a: 'off' }, { a: '' }],
	},
	{
		// Every `<option>` goes through `renderer.option` -- `is_option_special` is the name alone --
		// so its attributes are written by `attributes()`, which writes a boolean one as `name=""`
		// whatever its value. A marker planted there never comes back, and `disabled=""` landed on
		// every item of the each. It is a decision, carried the way `selected` is.
		name: 'a boolean attribute on an option',
		source:
			`${PROPS}<select><option value="none">none</option>` +
			'{#each data.xs as x}<option disabled={data.taken.includes(x)} value={x}>{x}</option>{/each}' +
			'</select>',
		data: [
			{ xs: [1, 2, 3], taken: [2] },
			{ xs: [], taken: [] },
		],
	},
	{
		// `renderer.select()` compares the options against `value === undefined ? defaultValue :
		// value`, and writes neither attribute.
		name: 'a select with a defaultValue',
		source:
			`${PROPS}<select defaultValue={data.s}><option>a</option><option value="b">B</option></select>` +
			'<select value={data.v} defaultValue="b"><option>a</option><option>b</option></select>' +
			'<select multiple defaultValue={data.m}><option>a</option><option>b</option></select>',
		data: [
			{ s: 'a', v: 'a', m: ['a', 'b'] },
			{ s: 'b', v: undefined, m: [] },
		],
	},
	{
		// `build_attr_class`: `$.attr_class($.clsx(value), hash, { on: t })`, one call whose result
		// is the attribute or nothing, and a falsy directive removes its name from the value. The
		// call is Svelte's own, carried, with the hash read off the render.
		name: 'class: beside a class attribute that is an expression',
		source:
			`${PROPS}<b class={data.c} class:on={data.t}>x</b>` +
			'<i class={[data.c, "k"]} class:on={data.t} class:off={!data.t}>y</i>' +
			'<u class="a {data.c}" class:on={data.t}>z</u>' +
			'<em class={data.c} class:on={data.t}>w</em>' +
			'<style>b { color: red } i { color: blue }</style>',
		data: [
			{ c: 'on p', t: true },
			{ c: 'on p', t: false },
			{ c: null, t: false },
			{ c: 'q', t: true },
		],
	},
	{
		// Whether an element is scoped is decided by what its class could be, and
		// `gather_possible_values` reads a literal, a ternary, a logical and an array. A class the
		// walk hid from it was scoped where Svelte leaves it alone -- press writes
		// `class="truncate {tone === 'dark' ? 'text-black' : 'text-white'}"`, matching neither of
		// this stylesheet's rules, and that one class was every differing byte of two hundred and
		// sixty-seven of its responses. Here the readable shapes sit beside the ones the analysis
		// gives up on, so the scoping of each is Svelte's own.
		name: 'a class the css analysis can read',
		source:
			'<script>let { data } = $props(); const ell = (v) => String(v).toUpperCase();</script>' +
			`<b class="t {data.f ? 'p' : 'q'}">x</b>` +
			"<i class=\"t {data.f ? 'on' : 'q'}\">y</i>" +
			'<u class="t {data.f && \'q\'}">z</u>' +
			'<em class="t {data.c}">w</em>' +
			'<span class="t {ell(data.c)}">v</span>' +
			'<style>.on { color: red } .card { color: blue }</style>',
		data: [
			{ f: true, c: 'on' },
			{ f: false, c: 'q' },
		],
	},
	{
		// `class={[...]}` and `class={{...}}` go through `clsx` in Svelte's own output, and so does
		// a bare name, which may hold either.
		name: 'a class that is an array or an object',
		source:
			`${PROPS}<b class={[data.c, 'k', data.t && 'on']}>x</b><i class={{ on: data.t, off: !data.t }}>y</i>` +
			'<u class={data.c}>z</u><style>b { color: red } i { color: blue }</style>',
		data: [
			{ c: 'p', t: true },
			{ c: ['q', 'r'], t: false },
			{ c: null, t: false },
		],
	},
	{
		// `prepare_element_spread`: the class directives and the style directives are the third and
		// fourth arguments of the one `$.attributes` call, and an attribute mixing text and an
		// expression is one template in the object. All of it is Svelte's own call, read back.
		name: 'directives and mixed text beside a spread',
		source:
			'<script>let { data } = $props(); const on = data.t;</script>' +
			'<div {...data.r} class:on style:color={data.c} a="x{data.y}" class="k">x</div>' +
			'<p {...data.r} class:off={!data.t} style:width="{data.w}px" style:margin|important={data.m}>y</p>' +
			'<style>div { color: red }</style>',
		data: [
			{ r: { id: 'i', class: 'on q' }, t: true, c: 'red', y: 'Y', w: 3, m: '1px' },
			{ r: {}, t: false, c: null, y: null, w: null, m: null },
		],
	},
	{
		// `$.element()` writes the tag and calls the same `$.attributes` for the run, so the run is
		// a hole inside the element block, hash and flags read back as on a written element.
		name: 'svelte:element with a spread',
		source:
			`${PROPS}<svelte:element this={data.tag} {...data.r} id="x" class:on={data.t}>c</svelte:element>` +
			'<svelte:element this={data.tag} {...data.r} /><style>div { color: red }</style>',
		data: [
			{ tag: 'div', r: { a: '1' }, t: true },
			{ tag: 'br', r: {}, t: false },
			{ tag: 'p', r: { class: 'q' }, t: false },
		],
	},
	{
		// `renderer.option` compares against the **rendered body** where the option writes no `value`
		// of its own, and a body holding a `{@render}` is bytes the render writes and nothing here
		// can name. The comparison is then the render's to make: nothing varies with the request, so
		// the bytes it writes are the bytes every request gets -- and leaving it to the render means
		// leaving both names on the tag, since `select()` reads them off the merged attributes.
		name: 'a `<select value>` whose options compare against a rendered body',
		source:
			'<script>let { data } = $props();</script>' +
			'<select value="dog"><option>{@render one("cat")}</option>' +
			'<option>{@render two("dog")}</option></select><p>{data.a}</p>' +
			'{#snippet one(v)}{v}{/snippet}{#snippet two(v)}{v}{/snippet}',
		data: [{ a: 'x' }],
	},
	{
		// `{...props}` on a component is `$.spread_props`, and a call site knows the keys exactly
		// when the object is written out, which a rest gathered from the caller's attributes is once
		// it is expanded. Then the spread is so many props and the child is entered.
		name: 'a spread on a component whose object is known',
		beside: {
			Outer:
				'<script>import Inner from \'./Inner.svelte\'; let { title, ...props } = $props();</script><h2>{title}</h2><Inner {...props} extra="e" />',
			Inner:
				'<script>let { a, b = 1, extra } = $props();</script><p>{a.toUpperCase()}{b * 2}{extra}</p>',
		},
		source:
			"<script>import Outer from './Outer.svelte'; let { data } = $props();</script>" +
			'<Outer title={data.t} a={data.a} b={data.b} onclick={() => {}} />',
		data: [
			{ t: 'T', a: 'x', b: 3 },
			{ t: '<', a: 'y', b: undefined },
		],
	},
	{
		// `{...data.obj}` on a component is `$.spread_props` over an object whose keys the request
		// decides. The child's `$props()` names what it reads, so each of those is the value the
		// merge leaves for it -- a later part overriding an earlier one by the key's presence, a
		// missing key leaving the default -- and the rest is the merge with the named keys taken
		// out, spread onto an element per request. See `merged()` in call-site.ts.
		name: 'a spread on a component whose object the request hands over',
		beside: {
			Inner:
				'<script>let { a, b = 1, extra, ...rest } = $props();</script><p {...rest}>{a}{b}{extra}</p>',
		},
		source:
			"<script>import Inner from './Inner.svelte'; let { data } = $props();</script>" +
			'<Inner {...data.obj} extra="e" /><Inner a="first" {...data.obj} b={data.n} />',
		data: [
			{ obj: { a: 'q', b: 2, title: 't' }, n: 7 },
			{ obj: { a: 'r', b: undefined, 'data-x': '1' }, n: undefined },
			{ obj: null, n: 0 },
		],
	},
	{
		// The other side of the same rule, and the one that says the fix is not a blanket anchor:
		// `RegularElement.js` never goes through `Fragment.js`, so its children read the enclosing
		// flag, which inside an element is always false -- Svelte writes the anchor here by itself
		// and a second one would be ours. Measured on `runtime-legacy/self-reference-tree`.
		name: 'a `<svelte:self>` alone inside an element, where Svelte writes the anchor itself',
		source:
			'<script>let { data } = $props();</script><ul>{#each data.items as item}' +
			'<li>{#if item.kids}<svelte:self data={{ items: item.kids }} />{:else}{item.name}{/if}</li>' +
			'{/each}</ul>',
		data: [{ items: [{ name: 'a' }, { kids: [{ name: 'b' }] }] }, { items: [] }],
	},
	{
		// Where an element carries a `class:` or a `style:` and no attribute of that name,
		// `2-analyze/index.js` appends one: `create_attribute('class', ...)` when it is scoped or
		// has a class directive, then `create_attribute('style', ...)` when it has a style one. Both
		// land after every written attribute, and class is appended first whichever order the
		// directives were written in. Here both are inserts at that one offset, and the one pushed
		// later comes out first, so the two passes run the other way round.
		name: 'a `class:` and a `style:` with no attribute of either name',
		source:
			`${PROPS}<p style:color={data.c} class:on={data.on}>a</p>` +
			'<p class:on={data.on} style:color={data.c} id="x">b</p>' +
			'<p style="margin:0" class:on={data.on}>c</p>',
		data: [
			{ c: 'red', on: true },
			{ c: '', on: false },
		],
	},
	{
		// `build_attr_style` writes `b.id(directive.name)` where a written value would have been
		// built, so `style:color` is the variable `color`. The name sits just past `style:` in the
		// source, which is where an expansion of it is read from.
		name: 'a `style:` in its shorthand form',
		source:
			'<script>let { data } = $props(); const color = data.c; const width = data.w;</script>' +
			'<p style:color style:width>a</p><i style:color="green">b</i>',
		data: [
			{ c: 'red', w: '2px' },
			{ c: '', w: null },
		],
	},
	{
		// `SlotElement.js` builds `$.spread_props([{ ...named }, ...spreads])` -- every written
		// attribute in one object first and then the spreads, which is not the order they were
		// written in, so a spread wins over a name beside it however they were arranged. Each
		// `let:` name is the fold that merge leaves for it.
		//
		// And a component carrying `slot=` is a named slot inside another one, so its `let:` scope
		// is that slot's rather than its own: `slot_scope_applies_to_itself`. Its own `<slot />`
		// passes nothing for the name, and reading it there used to write `undefined`.
		name: 'a slot with a spread, and a `let:` on a component that is itself a named slot',
		beside: {
			Outer: `${PROPS}<div>{#each data.rows as row}<slot name="foo" {row} />{/each}</div>`,
			Inner: '<script>export let row;</script><span>{row.n}</span><slot />',
			Spread:
				'<script>export let obj; export let c;</script><slot c={c} {...obj} d="d" /><slot name="x" />',
		},
		source:
			"<script>import Outer from './Outer.svelte'; import Inner from './Inner.svelte';" +
			" import Spread from './Spread.svelte'; let { data } = $props();</script>" +
			'<Outer {data}><Inner slot="foo" let:row={r} row={r}><b>{r.n}</b></Inner></Outer>' +
			'<Spread obj={data.obj} c={data.c} let:a let:c let:d><i>{a}{c}{d}</i></Spread>',
		data: [
			{ rows: [{ n: 1 }, { n: 2 }], obj: { a: 'A', c: 'over' }, c: 'c' },
			{ rows: [], obj: {}, c: '<' },
		],
	},
	{
		// Svelte calls its own helpers through `$.`; ours had them bare, so a component with a prop
		// called `attributes` -- an ordinary name for one -- put an object where the helper's name
		// was and the derivation called it. They are carried under a `$$` name now, which nothing
		// the author writes can shadow because Svelte reserves the prefix.
		name: 'a prop named after one of the helpers a spread calls',
		source:
			'<script>export let attributes = {}; export let myClass;</script>' +
			'<div class={myClass} {...attributes}></div>',
		props: [
			{ myClass: 'a', attributes: { id: 'x', title: 't' } },
			{ myClass: '', attributes: {} },
		],
	},
];
