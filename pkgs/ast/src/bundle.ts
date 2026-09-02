import { readFileSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import type { Bundle, Module } from './markup.ts';
import { reduce } from './reduce.ts';

// Resolution is Node's problem, not lowering's: which file a specifier names is a question
// about JavaScript modules, and reimplementing that in Rust would be reimplementing Node. What
// crosses into Rust is a set of components with the names already resolved.
function idOf(root: string, file: string): string {
	const withoutExtension = file.slice(0, -extname(file).length);
	return relative(root, withoutExtension);
}

export function bundle(entryFile: string): Bundle {
	const entry = resolve(entryFile);
	const root = dirname(entry);
	const components: Record<string, Module> = {};

	const pending = [entry];
	while (pending.length > 0) {
		const file = pending.pop();
		if (file === undefined) break;
		const id = idOf(root, file);
		if (id in components) continue;

		const module = reduce(readFileSync(file, 'utf8'));
		const resolved: Record<string, string> = {};
		for (const [local, specifier] of Object.entries(module.imports)) {
			// Only a component can be composed. Everything else the file imports stays in the
			// map unresolved, so lowering sees the name it could not follow rather than nothing.
			if (!specifier.endsWith('.svelte')) continue;
			const target = resolve(dirname(file), specifier);
			resolved[local] = idOf(root, target);
			pending.push(target);
		}
		components[id] = { markup: module.markup, imports: resolved };
	}

	return { entry: idOf(root, entry), components };
}
