/**
 * The IR's shape, which the lowering writes and the route's program is written from, and the parts
 * of Svelte's server output a program calls rather than writes: escaping, the title channel's
 * counters, `hydratable`'s script, and stepping through what waits. The program itself is
 * `@seam-js/program`'s; what it is handed is `./runtime.ts`. See spec/ir.md.
 */
export type { Branch, ComponentIR, EscapeMode, Node, Presence, Scope } from './ir.ts';
export type { Csp } from './hydratable.ts';
