/**
 * A child the walk could not enter, left to Svelte -- and which of the reasons are the author's to
 * see instead. See spec/refusals.md.
 */
/**
 * Entering a child component at a call site: what the tag passes, what the child's script
 * declares and changes, what a binding sends back, and the copy the child is walked as. See
 * spec/derivation.md.
 */
import { basename } from 'node:path';
import { rolled } from './compose.ts';
import { refuse } from './node.ts';
import { Undecided, type Walk } from './walk-types.ts';

/**
 * Rolls the walk back and returns false where Svelte renders the child as before, or throws
 * where leaving it to Svelte would write wrong bytes rather than a component nobody read.
 */
export function leftToSvelte(
	error: unknown,
	walk: Walk,
	mark: Parameters<typeof rolled>[1],
	tag: string,
	file: string,
	headed: boolean,
	handsMarker: (prop: string | undefined) => boolean,
): false {
	// Rolled back, and the component is rendered by Svelte the way it was before this tried.
	// A refusal from inside a child is a refusal about a file the author did not ask to
	// compile, so it is not theirs to see.
	rolled(walk, mark);
	// The walk asking for a second render is not the walk failing, and it is answered above.
	if (error instanceof Undecided) throw error;
	if (String((error as Error).message).includes('is part of a cycle')) throw error;
	// Left to Svelte, a child writing a head inside a block would render one head block where a
	// request renders one per branch or per item, and nothing downstream could tell. So this
	// one is the author's to see, with why the walk could not enter -- and so is a block found
	// deeper that cannot stand in the head stream, which says so itself.
	const reason = String((error as Error).message);
	// Nothing in the pass that asks the render is final: a branch the request never takes is
	// walked in it too, and a refusal inside one is about markup that never renders.
	if (walk.asking !== true && reason.includes('stand in the head stream')) throw error;
	// Left to Svelte, an `await` in markup would not compile at all: it is the author's to see.
	if (walk.asking !== true && reason.includes('async Svelte')) throw error;
	// Left to Svelte, a binding the child sends back writes the caller's markup a second time
	// and this compiler would keep the first pass, which is bytes nobody asked for rather than
	// a component it could not read. So it is the author's to see too.
	//
	// **Past one catch rather than all of them.** The binding is written in the markup of the
	// component this walk is in, not in the child that declares the prop, so that component is
	// the one to leave to Svelte: `bind_props` then runs inside Svelte's own render of it and
	// whatever it settled is there for the caller above to read. Rolling back only the child
	// leaves the binding in a copy this pass rewrote, where the value it fills in is a
	// placeholder's -- `component-binding-blowback-d` wrote `{}` where Svelte wrote
	// `{"value":"0:0"}`. Where there is no catch outside this one the entry holds the binding
	// and there is nothing to leave, so it reaches the author as before.
	if (walk.asking !== true && reason.includes('a binding the child sends back')) {
		const carried = error as { past?: true };
		if (carried.past !== true) {
			carried.past = true;
			throw error;
		}
	}
	// Left to Svelte, a child that changes a value is handed the marker standing for it and
	// computes with that: `export let value; value += 1` over a marker wrote `%%s0%%1`, which is
	// the marker back with a digit on it, so nothing downstream could tell. The author's to see
	// -- but only where a marker is what the child would be handed. A prop whose value here
	// reads nothing the request decides reaches Svelte's render as written, and the render runs
	// the child's script over it as a server would.
	if (
		walk.asking !== true &&
		reason.includes('is a prop this component changes') &&
		handsMarker(/^`([^`]+)`/.exec(reason)?.[1])
	) {
		throw error;
	}

	// Left to Svelte, a context read is evaluated in the render -- where the `setContext` above
	// it was handed the literal standing in for a request value, so the child bakes that. The
	// refusal has to reach the author rather than turn into a component rendered as it was.
	if (walk.asking !== true && reason.includes('a context read where a `setContext`')) {
		throw error;
	}
	// The same: left to Svelte, the read is evaluated against the render's own copy of the
	// module, which is not the one the artifact calls into. See `changedBy()`.
	if (walk.asking !== true && reason.includes('a module binding something in that module')) {
		throw error;
	}
	// Async Svelte outside its async mode is refused by Svelte's own compiler as well as by this
	// walk, so leaving it to the render is not the answer it is for a gap -- the render does not
	// take it either, answering `Cannot use \`await\` in deriveds and template expressions`,
	// which would put the sample in the list under upstream's words. See spec/suite.md.
	if (walk.asking !== true && reason.includes('which is async Svelte')) throw error;
	if (walk.asking !== true && headed && walk.within.length > 0) {
		refuse(
			`<${tag} /> writes a \`<svelte:head>\` inside a block, so the block has to stand in the ` +
				`head stream, and the walk could not enter it: ${reason.replace(/\. See spec\/refusals\.md$/, '')}`,
		);
	}
	if (process.env['SEAM_TRACE'] !== undefined) {
		console.error(
			`[seam] could not enter ${basename(file)}: ${reason.replace(/\s+/g, ' ').slice(0, 240)}`,
		);
	}
	walk.site.missed.push({ file, reason });
	return false;
}
