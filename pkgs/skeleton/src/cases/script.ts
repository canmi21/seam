/**
 * The script: declarations, reactive statements, the run where substitution cannot follow, and what the render reads per request.
 * Cases `skeleton.test.ts` runs; each carries the payloads its shape turns on. See spec/refusals.md.
 */
import { type Case, PROPS } from './case.ts';

export const cases: Case[] = [
	{
		// `$props()` destructures, so a default is taken where the property is `undefined` and the
		// question is about the payload rather than about what the name resolves to. Written as
		// `typeof Math === 'undefined'` it found the global and never took the default.
		name: 'a prop default whose name a global already has',
		source:
			'<script>let { data, Math = { min: () => "potato" } } = $props();</script>' +
			'<p>{Math.min(data.x, 5)}</p>',
		data: [{ x: 10 }],
	},
	{
		// Nothing is written for the value, and Svelte writes `void 0` there:
		// `args.length > 0 ? visit(args[0]) : b.void0`. So the name holds `undefined` while the
		// bytes are written, which is what a piece of client state looks like before the client has
		// it. The markup used to be told the name had to come from the props.
		name: 'state with no initial value',
		source:
			'<script>let { data } = $props(); let t = $state()</script>' +
			'{#if t}<b>y</b>{:else}<i>{data.a}</i>{/if}',
		data: [{ a: 'v' }],
	},
	{
		// The whole of what a client-only component looks like on the server: state with no value,
		// a handler that would set it, and markup that branches on it. Svelte renders the branch
		// for the value it has, which is none, and the client takes over from there.
		name: 'state a handler assigns, read in the markup',
		source:
			'<script>let { data } = $props(); let open = $state(); function show() { open = true }</script>' +
			'<button onclick={show}>{#if open}<b>{data.a}</b>{:else}<i>closed</i>{/if}</button>',
		data: [{ a: 'v' }],
	},
	{
		name: 'a let with no initial value',
		source: '<script>let { data } = $props(); let t</script><p>{t}</p><p>{data.a}</p>',
		data: [{ a: 'v' }],
	},
	{
		// A held value is written where the declaration was, so what it calls is what that file
		// imports. Gathering only the holes left the bundle without it, because the hole names a
		// reference to the held value rather than the value: the artifact compiled and the
		// derivation threw `make is not defined` per request. See `expressionsOf`.
		name: 'a held value that calls what its own file imported',
		alongside: { 'make.ts': "export const make = () => new Map([['a', 1]]);" },
		beside: { Held: '<script>let { xs } = $props();</script><b>{xs.size}</b>' },
		source:
			"<script>import Held from './Held.svelte'; import { make } from './make.ts';" +
			' let { data } = $props(); const xs = make();</script><Held {xs} /><i>{data.a}</i>',
		data: [{ a: 'x' }, { a: '' }],
	},
	// **The script run.** Each of these was refused: substitution maps a name to the expression it
	// was declared to be, and a script that changes the name afterwards leaves no single expression
	// standing for it. The instance script runs per request as Svelte compiled it and the reads are
	// fields of that run. See spec/derivation.md, "Where substitution cannot follow, the script runs
	// as Svelte compiled it".
	{
		name: 'a name assigned after it is declared',
		source: '<script>let { data } = $props(); let x = 1; x = 2</script><p>{data.a + x}</p>',
		data: [{ a: 1 }, { a: 5 }],
	},
	{
		name: 'an object mutated after it is declared',
		source:
			'<script>let { data } = $props(); const o = { a: 1 }; o.a = 2</script>' +
			'<p>{data.a + o.a}</p>',
		data: [{ a: 1 }, { a: 5 }],
	},
	{
		// Which of the two ran last is the analysis's topological order, which the run is Svelte's.
		name: 'two reactive statements assigning one name',
		source: '<script>export let a; let n = 1; $: n = a * 2; $: n = a * 3;</script><p>{a + n}</p>',
		props: [{ a: 1 }, { a: 3 }],
	},
	{
		// `legacy_reactive_declarations` unshifts `let max;` only for a name nothing else declares,
		// so the self-reference reads the declaration's own value here -- Svelte's answer, since the
		// run is Svelte's.
		name: 'a reactive statement reading the name it assigns beside a declaration',
		source: '<script>export let a; let n = 1; $: n = Math.max(a, n);</script><p>{a + n}</p>',
		props: [{ a: 0 }, { a: 3 }],
	},
	{
		// Svelte runs the instance script before the template, so `options` holds `bar` whatever the
		// request sent.
		name: 'a prop assigned after it is destructured',
		source: "<script>let { options = 'foo' } = $props(); options = 'bar'</script><p>{options}</p>",
		props: [{}, { options: 'x' }],
	},
	{
		// What the script's own statements do through a function -- handed to `untrack`, called by
		// name, handed to an iterator -- happens before the template, where the run captures.
		name: 'a value changed by a function handed to a call the render makes',
		source:
			"<script>import { untrack } from 'svelte'; let { data } = $props(); let seen = 0;" +
			' untrack(() => { seen += 1 });</script><p>{data.a + seen}</p>',
		data: [{ a: 1 }, { a: 5 }],
	},
	{
		name: 'a value changed by a function the script itself calls',
		source:
			'<script>let { data } = $props(); let seen = 0;' +
			' function bump() { seen += 1 } bump();</script><p>{data.a + seen}</p>',
		data: [{ a: 1 }, { a: 5 }],
	},
	{
		name: 'a `$:` that mutates through an iterator',
		source:
			'<script>export let a; const keys = ["x"]; let held = {};' +
			' $: keys.forEach((key) => { held[key] = 1; });</script>' +
			'<p>{JSON.stringify(held) + a}</p>',
		props: [{ a: 'p' }, { a: 'q' }],
	},
	{
		// A child's script run, per call site, over what the call site passes.
		name: 'a child assigning a name after declaring it, over a value the request decides',
		beside: {
			Gate:
				'<script>let { on } = $props(); let t = on; t = !!on;</script>' +
				'{#if t}<b>shown</b>{/if}',
		},
		source:
			"<script>import Gate from './Gate.svelte'; let { data } = $props();</script>" +
			'<Gate on={data.on} />',
		data: [{ on: true }, { on: '' }, { on: 'x' }],
	},
	{
		name: 'a child transforming what it is given beside a name it assigns',
		beside: {
			Chews:
				'<script>let { tag, ...rest } = $props(); let n = 1; n = 2;</script>' +
				'<i>{tag.toUpperCase()}{n}</i>',
		},
		source:
			"<script>import Chews from './Chews.svelte'; let { data } = $props();</script>" +
			'<Chews tag={data.a} />',
		data: [{ a: 'x' }, { a: 'yz' }],
	},
	{
		name: 'a child in an each running its script per item',
		beside: {
			Row: '<script>export let n; let doubled; $: doubled = n * 2;</script><li>{doubled}</li>',
		},
		source:
			"<script>import Row from './Row.svelte'; let { data } = $props();</script>" +
			'<ul>{#each data.rows as n}<Row {n} />{/each}</ul>',
		data: [{ rows: [1, 2, 3] }, { rows: [] }, { rows: [5] }],
	},
	{
		// A boundary is a block: whether its children threw and what `transformError` made of it are
		// the request's. See spec/ir.md, "A boundary that may throw is a block of its own, lowered to
		// an `if`". Both requests throw here with a different message, and the third does not.
		name: 'a boundary whose body calls over a request value',
		source:
			'<script>let { data } = $props(); function search(q) { if (q) throw new Error(q); return "ok"; }</script>' +
			'<svelte:boundary><p>{search(data.q)}</p>' +
			'{#snippet failed(e)}<i>{e.message}</i>{/snippet}</svelte:boundary>',
		data: [{ q: 'a' }, { q: '<b> --> </b>' }, { q: '' }],
		transformError: (error) => ({ message: (error as Error).message }),
	},
	{
		name: 'a boundary whose body throws for every request',
		source:
			'<script>let { data } = $props();</script>' +
			"<svelte:boundary><p>{data.a}{(() => { throw 'x'; })()}</p>" +
			'{#snippet failed(e)}<i>{e}</i>{/snippet}</svelte:boundary>',
		data: [{ a: 1 }],
		transformError: (error) => `caught ${String(error)}`,
	},
	{
		// The throw is inside a component, under an if the request decides: the run enters the copy
		// and takes the branch the render takes.
		name: 'a boundary whose child throws where the request says',
		beside: {
			Kid:
				'<script>let { ok, why } = $props();</script>' +
				'{#if ok}<b>{ok}</b>{:else}<s>{(() => { throw new Error(why); })()}</s>{/if}',
		},
		source:
			"<script>import Kid from './Kid.svelte'; let { data } = $props();</script>" +
			'<svelte:boundary><Kid ok={data.ok} why={data.why} />' +
			'{#snippet failed(e)}<i>{e}</i>{/snippet}</svelte:boundary>',
		data: [
			{ ok: 'fine', why: 'a' },
			{ ok: '', why: 'no <b>' },
		],
		transformError: (error) => `caught ${(error as Error).message}`,
	},
	{
		// The shape of Svelte's error-boundary-27: the child throws for every request, the failed
		// branch renders the same child given the error, and the child imports from the entry, so
		// each is entered as a fragment. The sample reads a `createContext` getter where this reads
		// a constant: the oracle here compiles the entry twice, and two contexts never meet.
		name: 'a boundary whose child always throws, rendered again by the failed snippet',
		beside: {
			Kid:
				"<script>import { label } from './entry.svelte'; let { error } = $props();</script>" +
				"{#if error}<p>caught: {error} ({label})</p>{:else}{(() => { throw 'catch me'; })()}{/if}",
		},
		source:
			"<script module>import Kid from './Kid.svelte'; export const label = 'hello';</script>" +
			'<script>let { data } = $props();</script>' +
			'<svelte:boundary>{#snippet failed(error)}<Kid {error} />{/snippet}<Kid /></svelte:boundary>' +
			'<p>{data.a}</p>',
		data: [{ a: 1 }],
		transformError: () => 'error',
	},
	{
		// Per item: the run iterates the list the render iterates and stops at the item that throws.
		name: 'a boundary whose each throws on one item',
		source:
			'<script>let { data } = $props(); function check(n) { if (n > 2) throw new Error(`big ${n}`); return n; }</script>' +
			'<svelte:boundary><ul>{#each data.xs as x, i}<li>{i}:{check(x)}</li>{:else}<li>none</li>{/each}</ul>' +
			'{#snippet failed(e)}<i>{e}</i>{/snippet}</svelte:boundary>',
		data: [{ xs: [1, 2] }, { xs: [1, 3, 5] }, { xs: [] }],
		transformError: (error) => (error as Error).message,
	},
	// **The build's render runs only what the run does not answer.** A statement that calls into a
	// name the render no longer computes is withheld from it, and the run computes it per request.
	// See spec/derivation.md.
	{
		// Svelte's reactive-values-uninitialised: `foo()` runs before the `$:`, over a `c` that the
		// render is given nothing for.
		name: 'a script call over a name a neutralised `$:` binds',
		source:
			"<script>export let a = 'a'; let b; $: c = a; function foo() { b = c === 'a' ? 'b' : 'c'; } foo();</script>" +
			'<p>{a}{b}{c}</p>',
		props: [{}, { a: 'z' }],
	},
	{
		// Svelte's reactive-values-function-dependency: a `$:` calls a function a neutralised block
		// assigned.
		name: 'a `$:` calling what a neutralised block assigns',
		source:
			'<script>let _x; function getX() { return _x; } export let y = 1; let xGetter; export let x;' +
			' $: { _x = y * 2; xGetter = getX; } $: x = xGetter();</script><p>{x}</p>',
		props: [{}, { y: 2 }],
	},
	{
		// Svelte's props-default-value-lazy-accessors: a default fires only where the request sent
		// nothing, and what it calls changes a name the markup reads.
		name: 'a prop default that changes a name the markup reads',
		source:
			'<script>let log = []; const fallback_value = 1;' +
			" const nested = { get fallback_value() { log.push('nested'); return fallback_value; } };" +
			" const fallback_fn = () => { log.push('fn'); return fallback_value; };" +
			' const { p0 = 1, p2 = nested.fallback_value, p3 = fallback_fn() } = $props();</script>' +
			'<p>{p0} {p2} {p3}</p><p>{log}</p>',
		props: [{ p0: 0, p2: 0, p3: 0 }, {}, { p2: 5 }],
	},
	// **What the markup changes while the bytes are written is changed in the run.** The run's
	// bindings are live, a function the markup calls is the run's own, and each read is read where
	// the render reads it. See spec/derivation.md.
	{
		name: 'a function the markup calls that changes a name the markup reads',
		source:
			'<script>let { data } = $props(); let n = 0;' +
			' function bump(v) { n += 1; return v }</script>' +
			'<p>{n}</p><p>{bump(data.a)}</p><p>{n}</p><p>{bump(data.b)}</p><p>{n}</p>',
		data: [
			{ a: 'x', b: 'y' },
			{ a: '', b: 'z' },
		],
	},
	{
		// Svelte's spread-component-side-effects: the spread is computed once and the change it makes
		// is the run's.
		name: 'a spread computed by a function that changes the script',
		beside: {
			Widget:
				'<script>export let i; export let foo; export let qux;</script>' +
				'<p>i: {i}</p><p>foo: {foo}</p><p>qux: {qux}</p>',
		},
		source:
			"<script>import Widget from './Widget.svelte'; export let foo = 'foo'; let i = 0;" +
			' const getProps = (foo) => { i += 1; return { foo, i }; };</script>' +
			'<div><Widget {...getProps(foo)} qux="named"/></div>',
		props: [{}, { foo: 'lol' }],
	},
	{
		// The same fault one level in, and it used to compile: the instance script runs once and a
		// function beside it closes over that one binding, while substitution gives every read its
		// own copy of the initialiser. Measured against Svelte before it was refused, `1|0` and
		// `2|0` where Svelte wrote `1|1` and `2|2`.
		name: 'a value changed by a function the markup calls',
		source:
			'<script>let { data } = $props(); const log = [];' +
			' function next(x) { log.push(x); return x; }</script>' +
			'{#each data.rows as row}<p>{next(row)}|{log.length}</p>{/each}',
		data: [{ rows: [1, 2] }, { rows: [] }],
	},
	{
		// A function written as an argument of a call is run by that call: `run(() => count += 1)`
		// from `svelte/legacy` is a `$:` migrated, and `untrack(() => count++)` is Svelte's own.
		// A plain name only -- `sleep(10).then(() => ...)` hands its function to a member, and what
		// a member does with one this pass does not know -- and not the runes `CallExpression.js`
		// answers with `void 0`, whose argument the server never runs.
		// And through the script's own statements, which Svelte puts ahead of the template: a
		// statement assigning through a call is the rule that refuses a direct one, one level in.
		// `let promise; new_promise()` left `{#await promise}` taking the wrong branch.
		// The same through a declaration rather than the markup: reading `first` writes `tick()` out
		// where the render evaluates it, so the call is made and what it changes is lost.
		name: 'a value changed by a function a declaration the markup reads calls',
		source:
			'<script>let { data } = $props(); const seen = [];' +
			' function tick() { seen.push(1); return seen.length; }' +
			' const first = tick();</script><p>{data.a + first}|{seen.length}</p>',
		data: [{ a: 1 }, { a: 5 }],
	},
	{
		// A getter is run by a property read, which is not something the reader wrote as a call, and
		// this pass writes a declaration's initialiser out at every read. So a getter that changes
		// something is a function this render calls, and the walk into it stops where a plain
		// function property's body stops -- what a function property does is decided by whoever
		// calls it, and nobody here does.
		name: 'a getter that changes what the markup reads',
		source:
			'<script>export let a; let seen = 0;' +
			' function tick() { seen += 1; return seen; }' +
			' const held = { get now() { return tick(); } };</script>' +
			'<p>{held.now + a}|{seen}</p>',
		props: [{ a: 1 }, { a: 2 }],
	},
	{
		// Svelte's await-then-destruct-computed-props over a value rather than a promise: the pattern
		// is taken apart once, its keys in order, and what they change is read after.
		name: 'a pattern whose computed keys change a name the markup reads',
		source:
			'<script>let { data } = $props(); let num = 1;</script>' +
			'{#await data.o then { [`p${num++}`]: a, [`p${num++}`]: b, ...rest }}' +
			'<p>{num}{a}{b}{num}{JSON.stringify(rest)}</p>{/await}',
		data: [{ o: { p1: 'x', p2: 'y' } }, { o: { p1: 'q', p2: 'r', p3: 's' } }],
	},
	{
		name: 'a markup expression that updates a name it reads again',
		source:
			'<script>let { data } = $props(); let num = 1;</script>' +
			'<p>{data.a}{num++}</p><p>{num}</p>{#each data.xs as x}<i>{x}{num++}</i>{/each}<p>{num}</p>',
		data: [
			{ a: 'q', xs: [1, 2] },
			{ a: 'r', xs: [] },
		],
	},
	// **What Svelte's render reads while it writes**, read per request and never at the build: a
	// module's state, a fresh symbol, a host's global. Each of these was refused. See spec/derivation.md,
	// "Ambient input is read at request time, never at the build".
	{
		// Changed only by a handler, which the server never runs: the state as it stands at the
		// request, read in the carried bundle's instance of the module.
		name: 'a read of module state only a handler changes',
		alongside: {
			'held.js': 'export let count = 0;\nexport function inc() { count += 1; }\n',
		},
		source:
			"<script>import { count, inc } from './held.js'; let { data } = $props();</script>" +
			'<button onclick={inc}>{count}{data.a}</button>',
		data: [{ a: 'x' }, { a: 'y' }],
	},
	{
		// One value per request where substitution would make one per read: two reads, one symbol.
		name: 'a declaration the markup reaches holding a value that is not the same twice',
		source:
			'<script>let { data } = $props(); const s = Symbol(); const o = { [s]: data.a };</script>' +
			'<p>{s in o}</p>',
		data: [{ a: 1 }],
	},
	{
		// A name no script writes is the host's, read where Svelte's render reads it.
		name: 'a name read under `typeof` and beside it',
		source:
			"<script>let { data } = $props(); globalThis['myst' + 'ery'] ??= 'm';</script>" +
			'<p>{typeof mystery}{mystery}{data.a}</p>',
		data: [{ a: 1 }],
	},
	{
		// A pattern's initialiser is written once per name it binds, and where it makes something
		// the names come out of different values. `destructure-state-iterable` is the shape upstream
		// wrote: `let [one, two] = $state(test())` over a generator, called twice, each call read
		// from the start. Held once, every name of the pattern reaches into one value.
		name: 'a pattern over an initialiser that makes something',
		alongside: { 'make.ts': 'export const make = () => { const v = {}; return { a: v, b: v } };' },
		source:
			"<script>import { make } from './make.ts'; let { data } = $props();" +
			' const { a, b } = make();</script>' +
			"<p>{a === b ? data.a : 'other'}</p>",
		data: [{ a: 'x' }, { a: '' }],
	},
	{
		// A shorthand property is one node standing as both key and value, so substituting it in
		// place takes the key with it and leaves `{ (data.n) }`, which is not JavaScript. The third
		// time this shape has come up: an attribute's `{n}` and a `{@const}` were the others. It is
		// how a locale reaches a message -- `m['x']({}, { locale })` -- so every translated string
		// in a real page went through it.
		name: 'an object shorthand whose value is substituted',
		source:
			'<script>let { data } = $props(); const n = data.n;</script>' +
			'<p>{Object.values({ n })[0]}</p><b>{Object.keys({ n }).join()}</b>',
		data: [{ n: 'v' }, { n: '<&' }],
	},
	{
		// A literal handed down through a component the walk entered. Every prop is handed to the
		// render as null, because the child's markers already carry the expressions and evaluating
		// what the call site passed would reach for data the render is not given -- but a literal
		// is not data, it reads nothing, and an expression over it is inert and left for Svelte.
		// Handed null it evaluated against nothing; the value the call site passed is carried now.
		name: 'a literal prop read by markup left for Svelte to evaluate',
		beside: {
			Tells:
				'<script>let { tag, ...rest } = $props();</script>' +
				"{#if tag === 'warm-x'}<i>warm</i>{:else}<i>{tag}</i>{/if}",
			Carries:
				"<script>import Tells from './Tells.svelte'; let { tone, data } = $props();</script>" +
				`<Tells tag={[tone, 'x'].join('-')} /><p>{data.a}</p>`,
		},
		source:
			"<script>import Carries from './Carries.svelte'; let { data } = $props();" +
			" const tone = 'warm';</script>" +
			'<Carries {tone} {data} />',
		data: [{ a: 'v' }, { a: '<&' }],
	},
	{
		// On the server there is no reactivity, so a rune is a declaration whose value is its
		// argument -- Svelte's own server transform says so in a line, and these hold that against
		// its output rather than against the reading of it. See spec/derivation.md.
		name: 'runes read from markup',
		source:
			'<script>let { data } = $props(); let n = $state(0); let t = $derived(data.a + "!"); ' +
			'let u = $derived.by(() => data.a.length); $effect(() => { n = 9 })</script>' +
			'<p>{n}/{t}/{u}</p>',
		data: [{ a: 'v' }, { a: '' }],
	},
	{
		// The refusal for a name assigned after it is declared must not reach a handler: one does not
		// run while the bytes are written, so the initialiser is still what the name holds. Held to
		// Svelte's own output rather than to that reasoning.
		name: 'a handler that assigns to a declared name',
		source:
			'<script>let { data } = $props(); let n = 0; function buy() { n += 1 }</script>' +
			'<button onclick={buy}>{data.a}{n}</button><b onclick={() => { n += 1 }}>{n}</b>',
		data: [{ a: 'v' }],
	},
	{
		// A `{@const}` is hoisted out of the fragment by `clean_nodes` and its visitor pushes it into
		// the block's `init`, ahead of the template, so it binds for the whole fragment however late
		// in it it was written. In legacy mode `sort_const_tags` then puts them in topological order,
		// so one may read another written below it. Red without either: `bar` is reported as a name
		// the data does not carry.
		name: 'a `{@const}` read above where it is written, in legacy mode',
		source:
			'<script>export let data;</script>' +
			'{#if data.f}<h1>{yoo}|{bar}</h1>{@const foo = bar}{@const yoo = foo + data.a}' +
			'{@const bar = "w"}{/if}',
		data: [{ a: 'x', f: true }],
	},
	{
		// A block is a scope, and only a function's parameters used to be one. The substitution
		// reached past the block's own `f` to the script's and wrote a different function's body,
		// which is bytes rather than a refusal -- found by a `{@const}` whose initialiser held one.
		name: 'a declaration inside an expression shadows the script it sits in',
		source:
			'<script>let { data } = $props(); const f = (x) => x;</script>' +
			'<p>{data.xs.map((x) => { const f = (y) => y * 2; return f(x) }).join(",")}</p>',
		data: [{ xs: [1, 2, 3] }],
	},
	{
		// Destructuring uses the iterator protocol -- Svelte's server writes plain JavaScript and lets
		// the engine do it -- so reading `value[0]` is the same answer for an array and no answer at
		// all for anything else. Red without `to_array`: a `Set` wrote nothing where Svelte writes
		// its two members, silently, which is the shape this exists to stop. The count is the one
		// `_extract_paths` passes, and it caps an unbounded iterable rather than exhausting it.
		name: 'an array pattern over something that is not an array',
		source: '<script>let { data } = $props(); let [a, b] = data.src;</script><p>{a}-{b}</p>',
		data: [{ src: new Set(['p', 'q']) }],
	},
	{
		// `_extract_paths` in `compiler/utils/ast.js` answers the same question for the client, and a
		// rest is the one way in that wraps the value rather than following it:
		// `exclude_from_object(v, keys)` over every key the pattern named. That is why what a name
		// reaches its value by is a template rather than a suffix.
		name: 'a rest in a declaration gathers what the pattern did not name',
		source:
			'<script>let { data } = $props(); const { a, ...rest } = data.o;</script>' +
			'<p>{a}|{JSON.stringify(rest)}</p>',
		data: [{ o: { a: 1, b: 2, c: 3 } }],
	},
	{
		// A nesting is one way in after another, and the two kinds alternate: a member, then the
		// iterator, then a member again.
		name: 'a nested pattern in a declaration',
		source:
			'<script>let { data } = $props(); const { o: { x }, xs: [, second] } = data;</script>' +
			'<p>{x}|{second}</p>',
		data: [{ o: { x: 'v' }, xs: ['a', 'b'] }],
	},
	{
		// `transform-server.js` declares **every identifier the left binds**, not only a plain name:
		// `for (const id of extract_identifiers(node.body.expression.left))`, each one whose binding
		// is `legacy_reactive`. So a `$:` assigning a pattern is a declaration of what it
		// destructures, and each name reaches the right the way any pattern does.
		name: 'a `$:` that assigns a pattern declares every name in it',
		source:
			'<script>export let data; $: ({ a } = data.o); $: [x, y] = data.xs;</script>' +
			'<p>{a}|{x}|{y}</p>',
		data: [{ o: { a: 'v' }, xs: ['p', 'q'] }],
	},
	{
		// `typeof x` on a name nothing binds is defined behaviour and reads the same everywhere:
		// `"undefined"`. It is how a file asks whether a global exists, Svelte compiles it unchanged,
		// and the render evaluates the same expression. Only where every read is guarded that way --
		// the second here has to resolve, and does, from the pattern beside it.
		name: 'a name read only under `typeof`',
		source:
			'<script>const held = { b: { c: 1 } }; const { b: { c } } = held;' +
			' let { data } = $props();</script><p>{typeof b}|{typeof c}|{c}|{data.a}</p>',
		data: [{ a: 'v' }],
	},
	{
		// `VariableDeclaration.js` lets exactly three runes through to the visitor that answers them
		// where they stand -- `$effect.tracking`, `$inspect` and `$effect.root` -- and every other
		// rune in a declaration is its first argument or `void 0`. So `$effect.pending()` holds `0`
		// in an expression and `undefined` in a declaration, which is the same rule read in two
		// places. Without this the name went unrecorded and the markup reading it was refused.
		name: 'a declaration whose initialiser is a rune the server answers',
		source:
			'<script>let { data } = $props(); const here = $effect.tracking();' +
			' const stop = $effect.root(() => {});</script><p>{here}|{typeof stop}|{data.a}</p>',
		data: [{ a: 'v' }],
	},
	{
		// A `{@const}` is a declaration scoped to its block, so it substitutes like any other
		// declared name -- chained, destructured, and in a branch's test. See spec/derivation.md.
		name: 'const tags',
		source:
			`${PROPS}{#if data.f}{@const n = data.n}{@const twice = n * 2}` +
			'{@const { k } = data.o}<i>{twice}{k}</i>{#if twice}<b>y</b>{/if}{/if}',
		data: [
			{ f: true, n: 3, o: { k: 'K' } },
			{ f: true, n: 0, o: {} },
		],
	},
	{
		// A name written in a type position is not a read, and a substitution written there is not
		// TypeScript: `T[k as keyof typeof T]` expanded `T` inside the `typeof` and stopped parsing.
		name: 'a substitution beside a type',
		source:
			'<script lang="ts">let { data }: { data: { k: string } } = $props();' +
			" const T = { a: 'A', b: 'B' } as const; const v = T[data.k as keyof typeof T];" +
			'</script><p>{v}</p>',
		data: [{ k: 'a' }, { k: 'b' }],
	},
	{
		// A value the request does not decide is bytes, computed by the render: a declaration
		// calling an import with nothing from the payload, a `$state` with no value, and a message
		// under a fixed locale. None of these is a hole, so none is asked for per request -- which
		// is what press's newsletter count needed, being client state whose server value is fixed
		// by construction and whose library cannot run outside a render. See spec/refusals.md.
		name: 'a value the request does not decide',
		alongside: {
			'count.ts': 'export const count = () => 3; export const greet = (l) => `hi-${l}`;',
		},
		source:
			"<script>import { count, greet } from './count.ts'; let { data } = $props();" +
			' const n = count(); let open = $state(); const msg = greet(data.locale);</script>' +
			'<p>{n}</p><i>{open}</i><b>{msg}</b><u title={n}>{data.a}</u>',
		fixed: { 'data.locale': '"en"' },
		data: [
			{ locale: 'en', a: 'x' },
			{ locale: 'en', a: '<&' },
		],
	},
	{
		// A `$:` that reads the name it assigns reads what that name held before the statement ran,
		// and `transform-server.js` unshifts `let max;` above the instance body for every
		// `legacy_reactive` binding a `$:` assigns -- so on the one pass the server makes that is
		// `undefined`. Left as the name it resolved nowhere per request.
		name: 'a `$:` that reads the name it assigns',
		source:
			'<script>export let num = 1; $: max = Math.max(num, max || 0);</script><p>{num} / {max}</p>',
		props: [{}, { num: 5 }],
	},
	{
		// A name the server holds and the build has not. Svelte reads it inside `render()`, once per
		// request, and a derivation is read once per request too, so the two agree -- what does not
		// agree is an expression judged inert and handed back to the compile-time render, which
		// would read the build machine's value and write it into the bytes.
		name: 'a read of the environment the server has and the build has not',
		beside: { Plainer: '<script>export let text;</script><i>{text}</i>' },
		source:
			"<script>import Plainer from './Plainer.svelte'; export let a;</script>" +
			'<p>{process.env.SEAM_TEST_VAR}</p><Plainer text={process.env.SEAM_TEST_VAR} /><b>{a}</b>',
		props: [{ a: 'x' }],
	},
	{
		// The shape Kit's generated root has, which is why this had to stay a path: `data_0 = null`
		// per level of the route. Rewriting each read into a guard was tried and turned every read
		// of every prop on every page into a derivation. See `Skeleton.defaults`.
		name: 'a default on a prop the markup reads fields off, which stays a path',
		source:
			'<script>let { form, page, data_0 = null } = $props();</script>' +
			'<h1>{data_0.title}</h1><p>{data_0.body}</p><a href={page.url}>{form}</a>',
		props: [
			{ form: 'f', page: { url: '/p' }, data_0: { title: 'T', body: 'B' } },
			{ form: 'f', page: { url: '/p' }, data_0: { title: 'T', body: 'B' }, extra: 1 },
		],
	},
	{
		// A path is a member chain rooted at a name the payload carries, and nothing in it says which
		// steps land on data and which on a string, an array or a number. Resolution used to stop at
		// anything that was not an object, so this wrote nothing where Svelte writes the number.
		name: 'a path whose last step reads a string or an array',
		source: `${PROPS}<p>{data.t.length}</p><i>{data.xs.length}</i><b>{data.xs[0]}</b>`,
		data: [
			{ t: 'abc', xs: ['q', 'r'] },
			{ t: '', xs: [] },
		],
	},
	{
		// A declaration reading a prop is neutralised for the render, which is given no data. The
		// legacy spellings of a prop were not counted as ones -- `export let` and `export { x as y }`
		// -- so `export let n; const twice = n.v * 2` kept its initialiser, and the render evaluated
		// `undefined.v` and threw a `TypeError` naming nothing: the crash the neutralisation exists
		// to prevent. Found by probe; the corpus shows four of these and they all read as
		// `Cannot read properties of undefined`.
		name: 'a declaration computed from a legacy prop',
		source:
			'<script>export let n; let m; export { m as q };' +
			' const twice = n.v * 2; const held = `[${m}]`;</script><p>{twice}{held}</p>',
		props: [
			{ n: { v: 21 }, q: 'x' },
			{ n: { v: 0 }, q: '<' },
		],
	},
	{
		// `LabeledStatement.js` collects a `$:` and `transform-server.js` puts it at the end of the
		// instance body in topological order, declaring `let x` for the name it assigns. So it is a
		// declaration whose initialiser is the right-hand side, and one reading another chains the
		// way two declarations do -- the ordering being what substitution does anyway.
		name: 'reactive declarations',
		source:
			'<script>export let a; let n = 2; $: doubled = a * n; $: label = `is ${doubled}`;' +
			' $: console.log(label);</script><p>{doubled} {label}</p>',
		data: [{ a: 3 }, { a: 0 }],
	},
	{
		// `CallExpression.js` answers every rune where it stands, and an expression holding one has
		// to be written as what Svelte writes there: `$effect.tracking()` is `false`,
		// `$effect.pending()` is `0`, `$effect.root()` a noop, `$state.eager(v)` the argument. They
		// were read as names the data has to carry.
		name: 'markup holding the runes the server answers',
		source:
			`${PROPS}<p>{$effect.tracking()}{$effect.pending()}{typeof $effect.root(() => {})}</p>` +
			'<p>{$state.eager(data.a)}</p>',
		data: [{ a: '1' }, { a: '<' }],
	},
	{
		// `console` reads the same everywhere -- `undefined` -- and what it does instead of returning
		// is not bytes, so it is one of the names nobody has to think about. Eight of Svelte's
		// samples log from markup and were refused for reading a name the data does not carry.
		name: 'markup that logs',
		source: `${PROPS}<p>{console.log(data.a) ?? data.a}</p>`,
		data: [{ a: '1' }, { a: '<' }],
	},
	{
		// `runtime-runes/bindable-prop-and-export`, the last of the four out of the skips. The
		// child declares `open` as a `$bindable()` and exports a function of the same name, so
		// `bind_props` is handed `{ open: is_open, open }` and the function wins the duplicate key.
		// None of that travels: the caller binds a value of its own that is not `undefined`, which
		// is the question the bindable half of this already asked and the readonly half did not.
		name: 'a readonly export bound where the caller holds a value',
		beside: {
			Held:
				'<script>let { open: is_open = $bindable() } = $props();' +
				' export function open() { is_open = !is_open; }</script>' +
				'<button>{is_open}</button>',
		},
		source:
			"<script>import Held from './Held.svelte'; let { data } = $props();" +
			' let open = $state(true);</script><Held bind:open /><b>{open}</b><i>{data.a}</i>',
		data: [{ a: 'x' }, { a: '' }],
	},
];
