/**
 * A field's structures, compiled and kept together.
 *
 * The build declares a payload path's domain, the pipeline runs once per value, and what comes
 * back is one whole compilation per value. This joins them into one artifact: an if over the path,
 * one branch per value, each branch the structure that value induces. See spec/pipeline.md.
 *
 * One artifact with a branch rather than one artifact per value, because the IR carries branches
 * already and nothing above it has to learn a new shape. Which of the two a project ships is a
 * deployment choice and can be taken later; this is the compilation either way.
 */
import type { Derivation } from 'derive';
import type { Branch, ComponentIR, Node } from 'injector';
import { javascript } from 'lowering';

/**
 * One compilation, with the IR read as the shape it is.
 *
 * `lowering` returns it as `unknown`, because crossing WebAssembly hands back JSON and nothing on
 * that side knows what it means. Joining several does know: it walks the nodes and renames what it
 * finds, so it reads them as the types the injector already declares. Both halves of the build
 * therefore agree by reading one declaration rather than by being kept in step.
 */
export interface Structure {
	ir: ComponentIR;
	derivations: Derivation[];
}

/** How many structures one entry may produce before the build says so. See spec/pipeline.md. */
export const MANY = 100;

/** One value of one path, as the literal source text a derivation compares against. */
export type Fixed = ReadonlyMap<string, string>;

/**
 * Which branch each `?:` handed to a component the walk could not enter takes, by its test.
 *
 * Found by the walk rather than declared by the build: a ternary handed to code the compiler
 * cannot read chooses what is handed, and the walk stops at the first it has not been told about
 * so the build can render once per branch. Nested ones are found one render deeper, so the runs
 * form a tree and a ternary inside a branch not taken is never rendered. See spec/refusals.md.
 */
export type Decided = ReadonlyMap<string, boolean>;

/** What one render was fixed at: the declared paths, and the choices found on the way to it. */
export interface Run {
	fixed: Fixed;
	decided: Decided;
}

/** The test one run's structure is kept under: everything it was fixed at, all of it true. */
export function testOf(run: Run): string {
	return [
		...[...run.fixed].map(([path, value]) => `${path} === ${value}`),
		...[...run.decided].map(([test, taken]) => (taken ? `(${test})` : `!(${test})`)),
	].join(' && ');
}

/**
 * Every combination of the declared domains, in order, each as the paths it fixes.
 *
 * A cartesian product, because two declared fields are two dimensions and a page may turn on both.
 * The count is what the warning is about: it multiplies, and a build that reaches a hundred is
 * more likely to have declared a domain against a field that is not one.
 */
export function combinations(domains: Readonly<Record<string, readonly unknown[]>>): Fixed[] {
	let found: Fixed[] = [new Map()];
	for (const [path, values] of Object.entries(domains)) {
		const next: Fixed[] = [];
		for (const held of found) {
			for (const value of values) {
				next.push(new Map([...held, [path, JSON.stringify(value)]]));
			}
		}
		found = next;
	}
	return found;
}

/** The names in a node that are derivations rather than data paths, rewritten. */
function renamed(nodes: readonly Node[], by: ReadonlyMap<string, string>): Node[] {
	const path = (one: string): string => by.get(one) ?? one;
	return nodes.map((node): Node => {
		switch (node.t) {
			case 'static':
				return node;
			case 'slot':
				return { ...node, path: path(node.path) };
			case 'if':
				return {
					...node,
					branches: node.branches.map((branch): Branch => ({
						test: branch.test === null ? null : path(branch.test),
						body: renamed(branch.body, by),
					})),
				};
			case 'each':
				return { ...node, source: path(node.source), body: renamed(node.body, by) };
			case 'attr':
				return { ...node, parts: renamed(node.parts, by) };
			case 'title':
				return { ...node, body: renamed(node.body, by) };
			case 'call':
				return {
					...node,
					fragment: path(node.fragment),
					binds: node.binds.map(([name, one]): [string, string] => [name, path(one)]),
				};
		}
	});
}

/**
 * One compilation out of several, each made with the paths fixed at one combination of values.
 *
 * **Every branch carries its own test and there is no else.** The tempting shape is to let the
 * last combination be the else, which makes the artifact total -- and total by handing a value
 * outside the declared domain somebody else's structure. Measured: with `en`, `fr` and `de`
 * declared, a payload saying `ja` rendered the German page, and nothing anywhere said so.
 *
 * A page that renders nothing is a bug report. A page in the wrong language for one reader is not,
 * and this compiler exists to not write bytes it cannot stand behind. The domain is a promise the
 * build makes; where the data breaks it, the artifact has no structure to offer and says so by
 * having none.
 */
export function joined(
	component: string,
	runs: readonly (Run & { compiled: Structure })[],
): Structure {
	const [only] = runs;
	if (only === undefined) throw new Error('a component compiled to no structures at all');
	if (runs.length === 1) return only.compiled;

	const derivations: Derivation[] = [];
	const body: Branch[] = [];
	const head: Branch[] = [];
	const title: Branch[] = [];
	const fragments: Record<string, Node[]> = {};

	// One entry per distinct derivation, however many runs wrote it. A derivation is a pure
	// expression over the payload, so two runs that wrote the same one -- the same expression, the
	// same scope, scoped or not, over the same files -- compute the same value and can be the one
	// entry. **Most of them are the same one.** press's article joins fifty-four structures and
	// wrote 13,224 derivations between them, of which 286 are distinct: `('still') === 'restoring'`
	// alone appeared 216 times. Every one of them is evaluated once per request, so this is the
	// bytes and the work both.
	const shared = new Map<string, string>();
	const key = (one: Derivation): string =>
		JSON.stringify([one.expression, one.scope, one.scoped === true, one.files ?? null]);

	for (const [at, run] of runs.entries()) {
		// A derivation is named for its position among its own component's, so several components'
		// collide by construction. Each run's is pointed at the shared entry its content names.
		const by = new Map<string, string>();
		for (const one of run.compiled.derivations) {
			const held = shared.get(key(one));
			if (held !== undefined) {
				by.set(one.name, held);
				continue;
			}
			const name = `__v${String(derivations.length)}`;
			shared.set(key(one), name);
			by.set(one.name, name);
			derivations.push({ ...one, name });
		}
		// A fragment is named for its position among its own component's too, so each run's are
		// moved the same way, and the calls that name them with them.
		for (const name of Object.keys(run.compiled.ir.fragments ?? {})) {
			by.set(name, `__w${String(at)}${name.slice(3)}`);
		}
		for (const [name, nodes] of Object.entries(run.compiled.ir.fragments ?? {})) {
			fragments[by.get(name) ?? name] = renamed(nodes, by);
		}
		// Tested against the values it was compiled for, which is a derivation like any other: the
		// IR tests a path's truth and never an expression, so the comparison is computed before it
		// is tested.
		// The test is source text a `?:` was written with, and a `lang="ts"` component writes it
		// with types in; every derivation is JavaScript by the time it is evaluated.
		const test = `__t${String(at)}`;
		derivations.push({ name: test, expression: javascript(testOf(run)), scope: null });
		body.push({ test, body: renamed(run.compiled.ir.body, by) });
		head.push({ test, body: renamed(run.compiled.ir.head, by) });
		title.push({ test, body: renamed(run.compiled.ir.title, by) });
	}

	// A node written the same way in more than one branch is one node. The branches of a joined
	// route are the same page compiled against different values, so most of what they hold is the
	// same page: press's article joins fifty-four of them, whose bodies hold thirty-odd top-level
	// nodes each and ninety distinct ones between them -- 4.29 MB of nodes that are 0.67 MB of
	// distinct nodes. A branch that is the only one holding a node keeps it, since a call plus a
	// fragment is bigger than the node.
	//
	// **A call inherits the scope it sits in**, adding a frame of its own for what it binds, so a
	// hoisted node reads what it read where it was written -- an each's item, a scoped derivation,
	// a title's place in the order -- and binds nothing. See `case 'call'` in `pkgs/injector`.
	//
	// It is marked `shared`, which is what says it takes no frame of its own. A frame is for a
	// fragment with parameters, and one here would capture what a `fresh` slot writes into the
	// innermost scope for the reads of it further along -- measured: `id="bits-s1"` became
	// `id="bits-"` on every page carrying a menu.
	const seen = new Map<string, number>();
	for (const branch of [...body, ...head, ...title]) {
		for (const node of branch.body) {
			const text = JSON.stringify(node);
			seen.set(text, (seen.get(text) ?? 0) + 1);
		}
	}
	const held = new Map<string, string>();
	const hoisted = (nodes: readonly Node[]): Node[] =>
		nodes.map((node): Node => {
			const text = JSON.stringify(node);
			if ((seen.get(text) ?? 0) < 2) return node;
			let name = held.get(text);
			if (name === undefined) {
				name = `__f${String(held.size)}`;
				held.set(text, name);
				fragments[name] = [node];
			}
			return { t: 'call', fragment: name, binds: [], shared: true };
		});
	for (const branch of [...body, ...head, ...title]) branch.body = hoisted(branch.body);

	const ir: ComponentIR = {
		component,
		body: [{ t: 'if', branches: body }],
		head: [{ t: 'if', branches: head }],
		// An empty title in every branch is no title at all, and an if around nothing would make
		// the head end with a `<title></title>` that Svelte never wrote.
		title: title.every((one) => one.body.length === 0) ? [] : [{ t: 'if', branches: title }],
		...(Object.keys(fragments).length === 0 ? {} : { fragments }),
	};
	return { ir, derivations };
}
