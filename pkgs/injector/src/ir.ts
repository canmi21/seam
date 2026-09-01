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
	| { t: 'each'; source: string; item: string; body: Node[] };

export interface ComponentIR {
	component: string;
	nodes: Node[];
}
