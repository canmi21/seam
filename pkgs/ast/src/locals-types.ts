/**
 * What `locals()` records of a script's declarations and hands the walk. See spec/derivation.md.
 */
import type { Neutral } from './edits.ts';
import { type Node } from './scope.ts';

/** One name a script declares, and the source of what it was declared to be. */
export interface Declared {
	name: string;
	/** The initialiser, as written. */
	source: string;
	/** Where it sits in the file, so a render can be given something harmless in its place. */
	at: [number, number];
	/** Whether it reads a prop, which decides whether a render with no data can hold it. */
	reads: boolean;
	/**
	 * The expression that reaches this name from the initialiser, as a template over `INIT`: `INIT`
	 * itself where the declaration named it directly, `INIT.a` out of an object, and a call around
	 * it where a rest gathers what the pattern did not name. A template rather than a suffix
	 * because `exclude_from_object` and `to_array` wrap the value rather than follow it, and a
	 * pattern may alternate the two.
	 */
	reach: string;
	/**
	 * The nodes the `SLOT(n)` places in `reach` stand for: a default's value, a computed key. They
	 * are expressions in the declaration's own scope, so they are expanded the way the initialiser
	 * is rather than written into the template as source.
	 */
	slots: readonly Node[];
	/**
	 * What a render is handed in its place, as source: `null` for a plain declaration, and a value
	 * shaped like the pattern where it destructured, at every level. See `emptyFor`.
	 */
	holds: string;
	/**
	 * The rune the declaration was written with, where it was: `$state`, `$derived`. Svelte's
	 * analysis reads a component tag naming such a declaration as dynamic and writes anchors
	 * around it, which a tag naming a plain `const` does not get. See `walk.ts`.
	 */
	rune?: string;
	/**
	 * Declared by a `$:` rather than by a declaration, which is a difference one rule cares about:
	 * the statement that declares it is also an assignment to it, and the rule that refuses an
	 * assignment after a declaration must not read it as one. See `reactives()`.
	 */
	reactive?: true;
	/**
	 * What the name expands to, where that is not a span of the source.
	 *
	 * `let t;` and `let t = $state()` declare a name with nothing written for its value, and
	 * Svelte's server transform answers both the same way: `args.length > 0 ? visit(args[0]) :
	 * b.void0`, so the declaration holds `undefined`. There is no source to slice for that, so it
	 * is carried here instead.
	 */
	literal?: string;
}

export interface Locals {
	/**
	 * The names substitution cannot follow, each with the sentence that says why.
	 *
	 * A read of one is left as the author wrote it: the render runs the instance script and has the
	 * value, so an expression the render evaluates is right without anything being done to it. What
	 * cannot follow the change is writing the initialiser at each read, so the name survives into
	 * any expression this compiler has to write itself and the refusal is made there.
	 */
	changed: ReadonlyMap<string, string>;
	/** Whether the scripts declare this name. */
	has: (name: string) => boolean;
	/** The rune a declaration was written with, or undefined for a plain one or no declaration. */
	rune: (name: string) => string | undefined;
	/** The names declared with `$props.id()`, which the render evaluates and which hold a string. */
	ids: ReadonlySet<string>;
	/**
	 * An expression's source with every declared name replaced by what it was declared to be.
	 *
	 * `extra` names things a script did not declare, mapped to the source that stands for them. A
	 * snippet's parameter is the case it exists for: its value is the argument at the one
	 * `{@render}` that calls the snippet, which this file cannot see.
	 */
	rewrite: (
		node: unknown,
		extra?: ReadonlyMap<string, string>,
		/**
		 * Names that stand for something **only where the expression itself reads them**, never
		 * inside a declaration this pass expands on the way. A component `bind:` is what this is
		 * for: `transform-server.js` wraps only `template.body` in the settling loop, so the
		 * template's own reads see what the child sent back and a `const y = x * 2` above keeps the
		 * value `x` had before it. One name, two values, told apart by where the read is.
		 */
		sent?: ReadonlyMap<string, string>,
	) => string;
	/**
	 * Where a declaration that reads a prop sits, and what to put there instead. A render is
	 * given no data, so holding one is how a component used to crash inside Svelte's own renderer
	 * rather than being refused. A destructuring needs something it can be taken apart from,
	 * which `null` is not.
	 */
	reading: Neutral[];
}
