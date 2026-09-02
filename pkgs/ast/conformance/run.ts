// Guards the one thing this package cannot control: Svelte's AST shape. A rename like
// EachBlock.context would otherwise reduce to a null item and reach lowering as a component
// that has no iteration variable, which is a wrong answer rather than a failure.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reduce } from '../src/reduce.ts';

const here = dirname(fileURLToPath(import.meta.url));
const component = resolve(here, '../../injector/conformance/cases/product.svelte');
const fixture = resolve(here, '../fixtures/product.markup.json');

const actual = JSON.stringify(reduce(readFileSync(component, 'utf8')), null, '\t');
const expected = readFileSync(fixture, 'utf8').trimEnd();

if (actual !== expected.trimEnd()) {
	console.error('the reduced markup no longer matches fixtures/product.markup.json');
	console.error('regenerate with: node pkgs/ast/src/main.ts <component> > <fixture>');
	process.exit(1);
}
console.log('markup reduction matches its fixture');
