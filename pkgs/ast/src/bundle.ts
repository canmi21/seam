import { readFileSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { bindings } from './bindings.ts';
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

		const source = readFileSync(file, 'utf8');

		// Before anything is read out of the markup, every name in it has to come from somewhere.
		// A local variable and a payload key are indistinguishable by shape, so without this a
		// component compiles and renders an empty string where the value should be.
		const loose = bindings(source).unresolved;
		if (loose.length > 0) {
			// One line per name rather than per occurrence, and the expression only where it says
			// more than the name does.
			const seen = new Map<string, string>();
			for (const one of loose) {
				if (!seen.has(one.name)) seen.set(one.name, one.expression);
			}
			const show = ([name, where]: [string, string]): string =>
				where === name ? `\`${name}\`` : `\`${name}\` in \`${where}\``;
			const ambient = loose.filter((one) => one.reason === 'ambient').map((one) => one.name);
			const unknown = [...seen].filter(([name]) => !ambient.includes(name)).map(show);
			const reasons = [
				unknown.length > 0 ? `${unknown.join(', ')}, which the data does not carry` : '',
				ambient.length > 0
					? `${[...new Set(ambient)].map((name) => `\`${name}\``).join(', ')}, which does not \
read the same twice`
					: '',
			].filter((one) => one !== '');
			throw new Error(`${relative(root, file)} reads ${reasons.join('; and ')}`);
		}

		const module = reduce(source);
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
