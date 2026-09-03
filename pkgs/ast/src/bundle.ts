import { readFileSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { resolved } from './resolved.ts';
import type { Bundle, Module } from './markup.ts';
import { reduce } from './reduce.ts';

// Resolution is Node's problem, not lowering's: which file a specifier names is a question
// about JavaScript modules, and reimplementing that in Rust would be reimplementing Node. What
// crosses into Rust is a set of components with the names already resolved.
function idOf(root: string, file: string): string {
	const withoutExtension = file.slice(0, -extname(file).length);
	return relative(root, withoutExtension);
}

/**
 * Every component the entry reaches, with the names already resolved.
 *
 * `projectRoot` is what component ids are relative to, and it is given rather than derived. It
 * used to be the entry's own directory, which is right for one entry and wrong for a project: two
 * entries in different directories would each name a shared component differently, so the same
 * file would appear twice under two ids and never merge. See spec/build.md.
 */
export function bundle(entryFile: string, projectRoot: string): Bundle {
	const entry = resolve(entryFile);
	const root = resolve(projectRoot);
	const components: Record<string, Module> = {};

	const pending = [entry];
	while (pending.length > 0) {
		const file = pending.pop();
		if (file === undefined) break;
		const id = idOf(root, file);
		if (id in components) continue;

		const source = readFileSync(file, 'utf8');

		// Before anything is read out of the markup, every name in it has to come from somewhere.
		// A local variable and a payload key are indistinguishable by shape, so without this a
		// component compiles and renders an empty string where the value should be.
		resolved(source, relative(root, file));

		const module = reduce(source);
		const targets: Record<string, string> = {};
		for (const [local, specifier] of Object.entries(module.imports)) {
			// Only a component can be composed. Everything else the file imports stays in the
			// map unresolved, so lowering sees the name it could not follow rather than nothing.
			if (!specifier.endsWith('.svelte')) continue;
			const target = resolve(dirname(file), specifier);
			targets[local] = idOf(root, target);
			pending.push(target);
		}
		components[id] = { markup: module.markup, imports: targets };
	}

	return { entry: idOf(root, entry), components };
}
