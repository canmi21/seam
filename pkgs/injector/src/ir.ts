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
	 * The title, which Svelte keeps in a channel of its own rather than in either stream, and
	 * which the client sets with `document.title = ...` rather than hydrating. Walking it yields
	 * either nothing or a whole `<title>` element. See spec/ir.md.
	 */
	title: Node[];
}
