/**
 * What a compile-time render produces: the bytes, and the record of every place a value goes.
 *
 * These are the shapes that cross into the next stage. `Hole` and `Block` are the two positions
 * spec/pipeline.md distinguishes -- a value written into the bytes, and a value deciding which
 * bytes exist -- and everything else here exists to say which stream one was found in and which
 * render was made to find it.
 */

/**
 * A decision position: the value chooses which bytes exist rather than being written into them.
 *
 * `tests` are the directive expressions in source order, and `outcomes` holds one finished
 * attribute string per combination of their truthiness, indexed by the bits -- test `i` truthy
 * sets bit `i`. Every string in it came out of Svelte's own `attr_class`, so the joining, the
 * removal branch, the escaping and the empty result that writes no attribute at all are its
 * answers rather than reproductions of them. See spec/refusals.md.
 */
export interface Choice {
	tests: string[];
	outcomes: string[];
}

/** One dynamic position, in the order it appears in the source. */
export interface Hole {
	index: number;
	expression: string;
	/** `{@html}`, which is the one thing about a hole the output cannot reveal. */
	raw: boolean;
	/** Set when the hole is a decision rather than a substitution. */
	choice?: Choice;
	/**
	 * Set when the hole is a call of a fragment: a recursive snippet or component rendering
	 * itself, where the runtime binds the fragment's parameters to these expressions and walks
	 * the fragment again. The render wrote the marker where the call sits. See spec/ir.md.
	 */
	call?: { fragment: string; binds: [name: string, expression: string][] };
	/**
	 * The files the expression was written across, innermost first: the component it sits in,
	 * then each caller up to the entry, relative to the root.
	 *
	 * A name in the expression resolves in the first of these that imports it. Substitution moves
	 * a prop's expression from the call site into the child's, so a child's expression may read
	 * the caller's imports; giving the evaluator the chain, innermost shadowing the rest, is what
	 * lets each file keep its own bindings -- and what lets two files import one module under one
	 * name two ways, which JavaScript allows and a single route-wide scope did not. See
	 * spec/derivation.md.
	 */
	files?: string[];
	/**
	 * The whole of an element's attributes, written by `$.attributes` at request time.
	 *
	 * A spread's keys arrive with the request, so which attributes exist cannot be enumerated and
	 * a marker cannot stand for one of them. It stands for all of them instead: the value is the
	 * finished run, ` a="1" b="2"`, and it is written raw because it is already escaped.
	 */
	spread?: true;
	/**
	 * The whole of one attribute rather than its value. A class written as an expression beside a
	 * `class:` directive is `attr_class(value, hash, directives)`, one call whose result is the
	 * attribute -- space, name and value -- or nothing, carried the way `attributes` is. The
	 * expression is finished after the render, which is where the hash comes from. See
	 * `outcomes()`.
	 */
	whole?: true;
	/**
	 * Allowed not to come back, because it was planted in markup a component does not render.
	 *
	 * Set only on positive evidence, never on absence: the same render is made a second time with
	 * that markup replaced by a literal nobody could produce, and this is set when the literal does
	 * not come back either. So it says *this component renders none of what it is given*, which is
	 * a fact about the component, rather than *the marker is missing*, which is also what a broken
	 * compiler looks like. See spec/refusals.md.
	 */
	safe?: true;
	/**
	 * The anchor of a `$props.id()`: the value is made by the runtime rather than read from data.
	 *
	 * Svelte's server writes `<!--$id-->` at the start of a component that declares one, with an id
	 * from a counter it keeps per render, and the client reads the id back from that anchor when it
	 * hydrates. Static bytes cannot carry it -- an each body would repeat one id per item, and two
	 * branches rendered separately would collide -- so the runtime counts instead, in the same
	 * order Svelte does, and binds the value under `expression` for every read that follows. See
	 * spec/ir.md.
	 */
	fresh?: true;
	/**
	 * The component this value was handed to, and the prop it was handed as.
	 *
	 * Carried for the diagnostic rather than for the compilation. A component is a plain function
	 * call with no anchor around what it writes, so when a marker does not come back the assembler
	 * sees an absence and nothing else; this is the one thing the walk knows that it does not.
	 */
	given?: string;
}

/** Which of Svelte's two output streams something was rendered into. */
export type Stream = 'body' | 'head';

/** One if or each in the source, in document order. */
export interface Block {
	index: number;
	kind: 'if' | 'each' | 'element';
	/**
	 * Blocks are numbered across the whole source but appear in one stream or the other, and the
	 * bytes give no way to tell which: the same two ifs, one in the head and one in the body,
	 * render identically whichever came first. So the stream is recorded here, where the AST
	 * still says.
	 */
	stream: Stream;
	/** The test of an if, or the source of an each, as written. */
	expression: string;
	/**
	 * Every test of an if, in order, which is one per branch before the final else.
	 *
	 * `{:else if}` is one block rather than a nested one. Svelte's server transform flattens the
	 * chain -- `metadata.flattened` in `visitors/IfBlock.js` -- and tells the branches apart by
	 * numbering the marker it opens with: `<!--[0-->`, `<!--[1-->`, and `<!--[-1-->` for the else.
	 * The AST nests them, so a walk that followed it would number blocks the render never wrote.
	 */
	tests?: string[];
	/**
	 * The branch each enclosing if has to be on for this block to be rendered at all, as pairs of
	 * block and branch. Empty for anything the baseline render holds.
	 *
	 * A block inside an `{:else}` only exists in the render made for that branch, so the render
	 * made for *its* own branches has to put its ancestors there too. Getting this wrong does not
	 * corrupt anything: the block simply does not appear, and the assembler says so.
	 */
	within?: [block: number, branch: number][];
	/** The name an each binds, or the pattern it binds through, as written. */
	item: string | null;
	/**
	 * What a destructuring context binds, as pairs of name and how it is reached from one element.
	 *
	 * `{#each Object.entries(m) as [k, v]}` binds two names and neither is the element. Svelte's
	 * server writes `let [k, v] = each_array[i]`, so the element has to come apart the way the
	 * pattern says -- and the render, which iterates one placeholder, has to hand it something that
	 * can. Absent for the ordinary case, where `item` is a name.
	 */
	binds?: [name: string, access: string][];
	/**
	 * The name an each binds to its counter, where it names one. The IR calls this `index`, which
	 * this field cannot: `index` here is the block's own ordinal, and the two collided once.
	 */
	counter?: string | null;
	/** True when the if has an else, which decides whether its alternate holds anything. */
	alternate: boolean;
	/**
	 * The body block this one stands in the head stream for. A headed component entered inside an
	 * if or an each writes its head block where the body runs, once per branch taken or per item,
	 * so the block exists in both streams; this is its head half. Bare, because the anchors the
	 * render writes for it are the walk's own, and rendered once: its alternates are the body
	 * half's. See `mirrored()` in walk.ts.
	 */
	mirrors?: number;
	/** The files its expression and tests were written across, as a hole's. See `Hole.files`. */
	files?: string[];
	/**
	 * Numbered by the walk and written by nothing, because it sits in markup a component does not
	 * render. It leaves the order the assembler counts against, or every ordinal after it shifts.
	 */
	absent?: true;
	/**
	 * An if Svelte writes without anchors: a content binding's `if (body) { value } else {
	 * children }`. The render carries anchors so the else can be found; the bytes do not.
	 */
	bare?: true;
	/**
	 * A bare block around the body of a recursive snippet or component, which the assembler keeps
	 * as a fragment the runtime calls: its parameters are the names the body reads per call, as an
	 * each's item is per iteration, and `binds` are what this first call binds them to. Every other
	 * call is a hole with `call` set. See spec/ir.md.
	 */
	fragment?: {
		name: string;
		params: string[];
		binds: [name: string, expression: string][];
		/**
		 * Whether the body opens with text. `is_text_first` in `clean_nodes` writes an empty comment
		 * ahead of a snippet's or component's body that does, and not ahead of an if's, so the bare
		 * block around the body loses it and the assembler writes it back.
		 */
		textFirst?: true;
	};
}

/** Both of Svelte's output streams, because reading only one of them loses content silently. */
export interface Rendered {
	body: string;
	head: string;
}

export interface Skeleton {
	/** Every if taken, every each with one item. Holds every consequent and every each body. */
	html: string;
	/**
	 * The other stream. `render()` returns a head as well as a body, and a component that writes
	 * to it produces bytes that belong in the document rather than in the fragment. Carried even
	 * though nothing assembles it yet, because the alternative is reading only the body and
	 * calling that the whole render, which is how a title came to compile and then not exist.
	 */
	head: string;
	/**
	 * One render per if, with that one not taken, holding its alternate. Keyed by block index.
	 * Both streams, because the if may be in either.
	 */
	alternates: Record<string, Rendered>;
	/**
	 * The names the entry's `$props()` destructures, which are the payload's keys, or null where
	 * the walk could not read them. What tells a path from an expression that merely spells like
	 * one: `URLS.external.fonts` is rooted at a constant a file imported, not at the payload.
	 */
	payload: string[] | null;
	holes: Hole[];
	blocks: Block[];
	/**
	 * Every component the walk went inside, as paths relative to the root the render was given.
	 *
	 * A child the walk entered has its own expressions become derivations in the entry's artifact,
	 * so what those expressions call has to be in the entry's carried bundle -- and the list of
	 * what to carry was read from the entry's imports alone. One the walk did not enter is rendered
	 * by Svelte and contributes no derivation, so it is not here. See spec/derivation.md.
	 */
	entered: string[];
}
