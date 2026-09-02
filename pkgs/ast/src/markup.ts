/** What `reduce` emits. Not the IR: nothing here has been decided yet, only narrowed. */
export type MarkupNode =
	| { k: 'text'; v: string }
	| { k: 'expr'; src: string }
	| { k: 'html'; src: string }
	| { k: 'element'; name: string; attrs: MarkupAttr[]; body: MarkupNode[] }
	// consequent/alternate rather than then/else: an object carrying a `then` is thenable, so
	// awaiting one anywhere would call it. The names are Svelte's own for the same fields.
	| { k: 'if'; test: string; consequent: MarkupNode[]; alternate: MarkupNode[] | null }
	| {
			k: 'each';
			source: string;
			item: string | null;
			index: string | null;
			key: string | null;
			body: MarkupNode[];
			fallback: MarkupNode[] | null;
	  }
	| { k: 'component'; name: string; props: MarkupAttr[]; body: MarkupNode[] }
	| { k: 'unsupported'; type: string; src: string };

export type MarkupAttr =
	| { k: 'attr'; name: string; value: true | MarkupNode[] }
	| { k: 'unsupported'; type: string; src: string };

/** One component file. `imports` is every import it declares, unfiltered. */
export interface Module {
	markup: MarkupNode[];
	imports: Record<string, string>;
}

/** An entry and everything reachable from it, keyed by an id derived from the file path. */
export interface Bundle {
	entry: string;
	components: Record<string, Module>;
}
