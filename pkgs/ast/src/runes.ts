import { stripTypeScriptTypes } from 'node:module';
import { compileModule } from 'svelte/compiler';

/**
 * A module holding runes, which is a name and an extension rather than anything in the source.
 *
 * `$state`, `$derived` and the rest are compiled away by Svelte and exist nowhere at run time, so
 * a `.svelte.js` or `.svelte.ts` cannot be loaded as it is written -- `export let obj = $state({})`
 * is `$state is not defined` to any runtime. Svelte's own rule is the filename: `compileModule` is
 * what the server applies to one, and every loader that meets one has to apply it too.
 */
export const RUNES_MODULE = /\.svelte\.(?:js|ts)$/;

/**
 * One compiled the way the server compiles it.
 *
 * Here rather than in either caller because there are two: the compile-time render loads these
 * modules through Node, and the carried bundle loads them through the bundler, and a module
 * compiled one way in one place and another way in the other is two modules. TypeScript is
 * stripped first, `compileModule` taking JavaScript.
 */
export function runesModule(file: string, text: string): string {
	return compileModule(file.endsWith('.ts') ? stripTypeScriptTypes(text) : text, {
		generate: 'server',
		filename: file,
	}).js.code;
}

/**
 * The name the payload itself is bound under, for the expressions that need the object rather than
 * its keys.
 *
 * `$$props` is the object a component was called with, `$$restProps` what its declared props left
 * of that object, and a rest in `$props()` the same thing again. An expression reads its scope
 * through `with`, which binds the keys and not the object, so all three had nothing to be built
 * from. `$$` is Svelte's own reserved prefix -- `$$props`, `$$slots` -- so nothing an author writes
 * can shadow it, and Svelte's compiler refuses a `$`-prefixed reference in markup, which is what
 * keeps an expression naming it from being handed back to the render.
 *
 * Written here, where the expressions are written, and read by the evaluator that binds it.
 */
export const GIVEN = '$$given';
