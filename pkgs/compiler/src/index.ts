export {
	compile,
	merged,
	prepare,
	structures,
	type Entry,
	type Options,
	type Prepared,
	type Report,
} from './compile.ts';
// For a second caller that compiles one component at a time rather than a project: `compile()`
// batches lowering across every entry and writes artifacts, and a comparison against Svelte does
// neither. See pkgs/suite.
export { joined, type Run, type Structure } from './variants.ts';
