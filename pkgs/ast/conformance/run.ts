// Guards the one thing pkgs/ast does not control: Svelte's AST shape. A rename like
// EachBlock.context would otherwise reduce to a null iteration variable and reach lowering as a
// wrong answer rather than a failure.
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply, bindings, type Edit } from '../src/bindings.ts';
import { bundle } from '../src/bundle.ts';
import { reduce } from '../src/reduce.ts';

const cases = resolve(dirname(fileURLToPath(import.meta.url)), '../../../conformance/cases');
let failed = 0;

for (const file of readdirSync(cases)
	.filter((f) => f.endsWith('.svelte'))
	.toSorted()) {
	const name = file.slice(0, -'.svelte'.length);
	const actual = `${JSON.stringify(bundle(resolve(cases, file)), null, '\t')}\n`;
	const expected = readFileSync(resolve(cases, `${name}.markup.json`), 'utf8');
	if (actual === expected) {
		console.log(`match  ${name} reduces to its fixture`);
	} else {
		failed += 1;
		console.error(`DIFF   ${name} no longer reduces to its fixture`);
	}
}

// The other half of what this package decides: which names resolve. A case cannot cover a
// refusal, there being no fixture for a component that does not compile, so the refusals are
// written here. Each was a real failure before the pass existed, and each failed differently:
// silently, at request time, and inside Svelte's own renderer.
const refusals: [string, string, string][] = [
	[
		'a name that is neither a prop nor an import',
		'<script>let { data } = $props()</script><b>{helpers[data.k](data.v)}</b>',
		'helpers',
	],
	['a clock', '<script>let { data } = $props()</script><b>{Date.now()}</b>', 'Date'],
	[
		'a rest element, which is neither a member nor an index',
		'<script>let { data } = $props(); const { a, ...rest } = data.t</script><b>{rest}</b>',
		'rest',
	],
	[
		'a default inside a pattern',
		'<script>let { data } = $props(); const { a = 1 } = data.t</script><b>{a}</b>',
		'a',
	],
	['randomness', '<script>let { data } = $props()</script><b>{Math.random()}</b>', 'Math.random'],
];

const staging = mkdtempSync(join(tmpdir(), 'seam-bindings-'));
for (const [label, source, name] of refusals) {
	const file = join(staging, 'component.svelte');
	writeFileSync(file, source);
	let message = '';
	try {
		bundle(file);
	} catch (error) {
		message = (error as Error).message;
	}
	if (message.includes(`\`${name}\``)) {
		console.log(`match  ${label} is refused, naming ${name}`);
	} else {
		failed += 1;
		console.error(`MISS   ${label} was not refused by name: ${message || '(it compiled)'}`);
	}
}
// The other side of the same pass. An imported name is legal and is reported for bundling
// rather than refused, and the three import forms are not interchangeable when it comes to
// asking for the name again.
// A name a script declares is substituted into the expression that uses it, which is what makes
// a module constant and one reading props the same mechanism. `LIMIT` becomes what it was
// declared to be; `total` becomes an expression over the data, which is a derivation.
const substitutions: [string, string, string][] = [
	[
		'a module constant',
		'<script module>export const LIMIT = 10</script><script>let { data } = $props()</script><b>{data.p > LIMIT}</b>',
		'data.p > (10)',
	],
	[
		'a constant reading props',
		'<script>let { data } = $props(); const total = data.x * 2</script><b>{total}</b>',
		'(data.x * 2)',
	],
	[
		'a chain of them',
		'<script>let { data } = $props(); const a = data.x * 2; const b = a + 1</script><b>{b}</b>',
		'((data.x * 2) + 1)',
	],
	[
		'a function declaration',
		'<script>let { data } = $props(); function f(v) { return v }</script><b>{f(data.x)}</b>',
		'(function f(v) { return v })(data.x)',
	],
	[
		'an object destructuring, renamed',
		'<script>let { data } = $props(); const { a: b } = data.t</script><b>{b}</b>',
		'((data.t).a)',
	],
	[
		'an array destructuring',
		'<script>let { data } = $props(); const [x] = data.t</script><b>{x}</b>',
		'((data.t)[0])',
	],
];
for (const [label, source, expected] of substitutions) {
	const found = JSON.stringify(reduce(source).markup);
	if (found.includes(JSON.stringify(expected).slice(1, -1))) {
		console.log(`match  ${label} expands to ${expected}`);
	} else {
		failed += 1;
		console.error(`MISS   ${label} did not expand to ${expected}: ${found}`);
	}
}

const imports: [string, string, string][] = [
	['a named import', "import { cn } from './u.ts'", 'named:cn'],
	['a renamed import', "import { cn as c } from './u.ts'", 'named:c'],
	['a default import', "import cn from './u.ts'", 'default:cn'],
	['a namespace import', "import * as u from './u.ts'", 'namespace:u'],
];
for (const [label, statement, expected] of imports) {
	const name = expected.split(':')[1] ?? '';
	const source = `<script>${statement}; let { data } = $props()</script><b>{${name}.x ?? ${name}(data.v)}</b>`;
	const carried = bindings(source)
		.carried.map((one) => `${one.kind}:${one.local}`)
		.join(',');
	if (carried === expected) {
		console.log(`match  ${label} is carried as ${expected}`);
	} else {
		failed += 1;
		console.error(`MISS   ${label} came back as ${carried || '(nothing)'}, not ${expected}`);
	}
}

// Rewriting a source file is a list of replacements applied back to front, and two of them over
// the same characters means one place was recorded twice. Applying both writes the second into
// the middle of the first and hands Svelte a file nobody wrote; it happened, and it surfaced as
// an undefined variable naming nothing anybody could act on.
const source = 'const { a, b } = data.t;';
const overlapping: Edit[] = [
	[17, 23, '{}'],
	[17, 23, '{}'],
];
let refused = '';
try {
	apply(source, overlapping);
} catch (error) {
	refused = (error as Error).message;
}
if (refused.includes('recorded twice')) {
	console.log('match  two edits over one place are refused rather than applied');
} else {
	failed += 1;
	console.error(`MISS   overlapping edits were applied: ${refused || apply(source, overlapping)}`);
}

// Adjacent is not overlapping, and refusing it would refuse ordinary work.
if (
	apply('abcd', [
		[0, 1, 'X'],
		[1, 2, 'Y'],
	]) === 'XYcd'
) {
	console.log('match  adjacent edits are applied');
} else {
	failed += 1;
	console.error('MISS   adjacent edits were refused or misapplied');
}

rmSync(staging, { recursive: true, force: true });

if (failed > 0) {
	console.error('regenerate with: node conformance/generate.ts');
	process.exit(1);
}
