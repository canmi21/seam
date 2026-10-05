/**
 * A component's module script as a module of its own, for a derivation to read a binding from.
 *
 * A module script runs once, when the component's module is evaluated, and what it declares is
 * one value for every render. Svelte reads it from the module, and so does a derivation now: the
 * name is carried from `<file>.seam-module.ts`, which is the script's own source with what it
 * declares exported, built by the project's bundler with the project's plugins -- so StyleX
 * compiles its `stylex.create(...)` away here as it does in the component. Its initialiser written
 * into a derivation instead bypassed every such plugin and ran as written. See spec/derivation.md,
 * "A module script's binding is read from the module".
 *
 * The id sits beside the component, so a relative import in the script resolves from where the
 * script was written, and ends in `.ts`, so a bundler strips its types and a plugin looking for
 * JavaScript takes it.
 */
import { readFileSync } from 'node:fs';
import { parse } from 'svelte/compiler';
import { bound } from '@seam-js/ast';
import type { Plugin } from 'rolldown';

export const MODULE_SCRIPT = '.seam-module.ts';

interface Script {
	source: string;
	/** What it declares as a variable at its top level, which a derivation may read. */
	declared: Set<string>;
	/** What it exports already, which is not exported a second time. */
	exported: Set<string>;
}

const read = new Map<string, Script | null>();

/**
 * Every module script read, forgotten: the dev server compiles again once a file changes, and this
 * is held by path. See spec/build.md, "How the dev server compiles a route".
 */
export function forgetModuleScripts(): void {
	read.clear();
}

function scriptOf(file: string): Script | null {
	if (read.has(file)) return read.get(file) ?? null;
	let found: Script | null = null;
	try {
		const text = readFileSync(file, 'utf8');
		const ast = parse(text, { modern: true }) as unknown as {
			module?: { content: { start: number; end: number; body: Record<string, unknown>[] } };
		};
		const module = ast.module;
		if (module !== undefined) {
			const declared = new Set<string>();
			const exported = new Set<string>();
			for (const statement of module.content.body) {
				const isExport = statement['type'] === 'ExportNamedDeclaration';
				const declaration = (isExport ? statement['declaration'] : statement) as
					| Record<string, unknown>
					| null
					| undefined;
				if (isExport && Array.isArray(statement['specifiers'])) {
					for (const one of statement['specifiers'] as { exported?: { name?: string } }[]) {
						if (typeof one.exported?.name === 'string') exported.add(one.exported.name);
					}
				}
				if (declaration?.['type'] !== 'VariableDeclaration') continue;
				for (const one of declaration['declarations'] as { id: unknown }[]) {
					const names = new Set<string>();
					bound(one.id, names);
					for (const name of names) {
						declared.add(name);
						if (isExport) exported.add(name);
					}
				}
			}
			found = {
				source: text.slice(module.content.start, module.content.end),
				declared,
				exported,
			};
		}
	} catch {
		// A file that does not parse carries nothing from its module script; the compile said why.
	}
	read.set(file, found);
	return found;
}

/** The names `file`'s module script declares as variables, which a derivation reads from it. */
export function moduleBindings(file: string): ReadonlySet<string> {
	return scriptOf(file)?.declared ?? new Set();
}

export function moduleScripts(): Plugin {
	return {
		name: 'seam:module-scripts',
		resolveId(id) {
			return id.endsWith(MODULE_SCRIPT) ? id : null;
		},
		load(id) {
			if (!id.endsWith(MODULE_SCRIPT)) return null;
			const script = scriptOf(id.slice(0, -MODULE_SCRIPT.length));
			if (script === null) return 'export {};';
			const more = [...script.declared].filter((one) => !script.exported.has(one));
			return `${script.source}\nexport { ${more.join(', ')} };\n`;
		},
	};
}
