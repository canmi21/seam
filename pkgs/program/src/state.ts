/**
 * What writing one route's program keeps while it writes: the derivations as the program writes
 * them, the names the IR's blocks bind, the carried names the program has read, and the counters
 * its variables are named by.
 */
import type { ComponentIR, Node as IrNode } from '@seam-js/injector';
import { computes } from './rewrite.ts';
import {
	type CarriedNames,
	type Derivation,
	guarded,
	type Info,
	json,
	metaFree,
	type Structure,
	textKey,
	waits,
} from './model.ts';
import { expression } from './names.ts';

export class Program {
	readonly ir: ComponentIR;
	readonly derivations: readonly Derivation[];
	readonly carried: CarriedNames;
	readonly infos = new Map<string, Info>();
	/** Every name a block of the IR binds anywhere: what a per-item derivation may be called with. */
	readonly blockNames = new Set<string>();
	/** What the program reads once, as it starts: each carried name it reads, as a variable. */
	readonly module: string[] = [];
	/** Whether the program waits, which makes its walk a generator `drive` steps through. */
	readonly generator: boolean;
	/** Whether a derivation calls Svelte's `hydratable`, whose values the head opens with. */
	readonly hydrating: boolean;
	/**
	 * The derivations a guard may name instead of computing their text again, by whether they are
	 * per item, files and text: one per item read where the item is bound is not the same value as
	 * one of the request's with the same text, which reads what the request holds under that name.
	 */
	readonly byText = new Map<string, Info>();
	/** What each fragment reads from its caller beyond its own parameters, by the function. */
	readonly needs = new Map<string, Set<string>>();
	readonly #carriedVars = new Map<string, string>();
	#temp = 0;

	constructor(structure: Structure, carried: CarriedNames) {
		this.ir = structure.ir;
		this.derivations = structure.derivations;
		this.carried = carried;
		for (const nodes of [
			this.ir.body,
			this.ir.head,
			this.ir.title,
			this.ir.styles ?? [],
			...Object.values(this.ir.fragments ?? {}),
		]) {
			this.#collectNames(nodes);
		}
		const waiting = waits(this.derivations);
		for (const [index, derivation] of this.derivations.entries()) {
			if (derivation.scope !== null && derivation.scope !== undefined) {
				throw new Error(`a derivation over a scope of its own is not written: ${derivation.name}`);
			}
			this.infos.set(derivation.name, {
				derivation,
				index,
				kind:
					derivation.prop === true
						? 'prop'
						: derivation.eager === true
							? 'eager'
							: derivation.scoped === true
								? 'scoped'
								: 'lazy',
				asynchronous: waiting.has(derivation.name),
				awaited: waiting.get(derivation.name) ?? [],
				marked: this.marked(derivation.files ?? []),
				params: [],
				memo: false,
			});
		}
		for (const info of this.infos.values()) {
			if (info.kind !== 'lazy' && info.kind !== 'scoped') continue;
			const key = textKey(info.derivation.files ?? [], info.derivation.expression);
			if (key !== null && !this.byText.has(`${info.kind}\u0002${key}`)) {
				this.byText.set(`${info.kind}\u0002${key}`, info);
			}
		}
		this.hydrating = [...this.infos.values()].some((one) => one.marked.size > 0);
		this.generator = this.hydrating || [...this.infos.values()].some((one) => one.asynchronous);
		this.#inferParams();
	}

	#collectNames(nodes: readonly IrNode[]): void {
		for (const node of nodes) {
			switch (node.t) {
				case 'slot':
					if (node.fresh === true) this.blockNames.add(node.path);
					break;
				case 'each':
					this.blockNames.add(node.item);
					if (node.index != null) this.blockNames.add(node.index);
					this.#collectNames(node.body);
					break;
				case 'call':
					for (const [name] of node.binds) this.blockNames.add(name);
					break;
				case 'if':
					for (const branch of node.branches) this.#collectNames(branch.body);
					break;
				case 'title':
					this.#collectNames(node.body);
					break;
				case 'attr':
					this.#collectNames(node.parts);
					break;
				default:
					break;
			}
		}
	}

	/**
	 * The per-item derivations' parameters, to a fixed point: one that reads another reads what that
	 * one is called with, wherever the reading one does not bind it itself.
	 */
	#inferParams(): void {
		const scoped = [...this.infos.values()].filter((one) => one.kind === 'scoped');
		for (let changed = true; changed;) {
			changed = false;
			for (const info of scoped) {
				const params = new Set<string>();
				expression(this, info, { chain: info.derivation.files ?? [], marked: info.marked, params });
				const sorted = [...params].toSorted();
				if (sorted.join('\u0000') !== info.params.join('\u0000')) {
					info.params = sorted;
					changed = true;
				}
			}
		}
		for (const info of scoped) {
			// A guard over what another derivation computes reads that one's kept value, and keeps
			// nothing of its own: the guard is not a maker. See `tried` in names.ts.
			const guard = guarded(info.derivation);
			const inner = guard === null ? null : guard.source.slice(guard.inner.start, guard.inner.end);
			const read =
				inner !== null &&
				this.byText.has(`scoped\u0002${textKey(info.derivation.files ?? [], inner) ?? ''}`);
			info.memo =
				info.params.length > 0 && !read && computes(inner ?? metaFree(info.derivation.expression));
		}
	}

	/** The names the files of a chain mark as Svelte's `hydratable`, the shared helpers' with them. */
	marked(chain: readonly string[]): Set<string> {
		const names = new Set<string>();
		for (const file of ['*', ...chain]) {
			for (const one of this.carried[file] ?? []) if (one.hydratable) names.add(one.name);
		}
		return names;
	}

	/** A carried name of the first file of the chain that holds it, as the variable it is read from. */
	fileName(chain: readonly string[], name: string): string | null {
		for (const file of chain) {
			if (!(this.carried[file] ?? []).some((one) => one.name === name)) continue;
			const key = `${file}\u0000${name}`;
			let held = this.#carriedVars.get(key);
			if (held === undefined) {
				held = `$c${String(this.#carriedVars.size)}`;
				this.#carriedVars.set(key, held);
				this.module.push(`const ${held} = ($files[${json(file)}] || {})[${json(name)}];`);
			}
			return held;
		}
		return null;
	}

	/** A variable of the program's own, under a name no other one has. */
	temp(prefix: string): string {
		this.#temp += 1;
		return `${prefix}${String(this.#temp)}`;
	}
}
