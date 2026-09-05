export type EscapeMode = 'content' | 'attr';

/**
 * How an attribute's value decides whether the attribute appears.
 *
 * - `value`: written unless the value is null or undefined.
 * - `boolean`: present or absent, `name=""` or nothing. HTML's boolean attributes.
 * - `nonempty`: written unless the value comes out empty, which is how `class` and `style` behave.
 */
export type Presence = 'value' | 'boolean' | 'nonempty';

export interface Branch {
	/** A data path, or null for the else. Never an expression: see spec/ir.md. */
	test: string | null;
	body: Node[];
}

export type Node =
	| { t: 'static'; s: string }
	| {
			t: 'slot';
			path: string;
			escape: EscapeMode | false;
			/**
			 * A `$props.id()` anchor. The value is the next id this response counts out, bound under
			 * `path` in the innermost scope for every read that follows, rather than resolved from
			 * data. Counted the way Svelte's server counts, so the bytes agree. See spec/ir.md.
			 */
			fresh?: true;
	  }
	| { t: 'if'; branches: Branch[] }
	| {
			t: 'each';
			source: string;
			item: string;
			index?: string | null;
			/**
			 * What a destructuring context binds, as name and how it is reached from one element.
			 * Absent where `item` is a name, which is the ordinary case. See spec/ir.md.
			 */
			binds?: [name: string, access: string][];
			body: Node[];
	  }
	| {
			/**
			 * A `<title>` where Svelte executed it, or the start of a head block holding one. Svelte
			 * keeps the title in a channel and `set_title` keeps the one whose render path compares
			 * later; a head block is hoisted ahead of its fragment, so the last head block executed
			 * wins and, inside it, the first title executed -- a top-level one before any inside a
			 * block. The injector applies the rule and appends the winner after the head. See
			 * spec/ir.md.
			 */
			t: 'title';
			role: 'open' | 'top' | 'nested';
			body: Node[];
	  }
	| {
			/**
			 * A call of one of the component's fragments: the runtime binds each parameter to the
			 * value at its path, in a scope of its own, and walks the fragment's body there. A
			 * component or a snippet rendering itself is this: the body is fixed, the depth is the
			 * data's. See spec/ir.md.
			 */
			t: 'call';
			fragment: string;
			binds: [name: string, path: string][];
	  }
	| {
			t: 'attr';
			name: string;
			/**
			 * How the value decides whether the attribute appears at all. Carried because the
			 * render cannot show it: a sentinel stands where a value is substituted, and none of
			 * these three substitute anything. See spec/ir.md.
			 */
			presence: Presence;
			parts: Node[];
	  };

/**
 * Two streams, named after Svelte's own because they are the same two. `render()` returns a head
 * and a body, and reading only one of them loses content with nothing to say so.
 */
export interface ComponentIR {
	component: string;
	body: Node[];
	head: Node[];
	/**
	 * A title written by a component the walk did not enter, which Svelte's own render decided
	 * and kept in its channel. Walking it yields either nothing or a whole `<title>` element, and
	 * where there is one it is the winner: it was decided by Svelte over everything the render
	 * held. A component the walk entered writes its titles as `title` nodes in the head stream
	 * instead. See spec/ir.md.
	 */
	title: Node[];
	/** The bodies `call` nodes walk, by name. Absent where the component has none. */
	fragments?: Record<string, Node[]>;
}
