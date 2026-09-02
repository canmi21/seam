export type EscapeMode = 'content' | 'attr';

export interface Branch {
	/** A data path, or null for the else. Never an expression: see spec/ir.md. */
	test: string | null;
	body: Node[];
}

export type Node =
	| { t: 'static'; s: string }
	| { t: 'slot'; path: string; escape: EscapeMode | false }
	| { t: 'if'; branches: Branch[] }
	| { t: 'each'; source: string; item: string; body: Node[] }
	| { t: 'attr'; name: string; parts: Node[] };

/**
 * Two streams, named after Svelte's own because they are the same two. `render()` returns a head
 * and a body, and reading only one of them loses content with nothing to say so.
 */
export interface ComponentIR {
	component: string;
	body: Node[];
	head: Node[];
}
