import { basename } from 'node:path';
import { compile } from 'svelte/compiler';
import { type PendingChoice, probe } from './attributes.ts';
import { refuse } from './node.ts';
import { renderRewritten } from './render.ts';
import { sentinel } from './sentinel.ts';
import type { Hole } from './shape.ts';
import { type Copy, type Rewritten, rewrite } from './walk.ts';

/**
 * Everything the walk could only anchor, finished once there is a render to read.
 *
 * Three questions have no answer before the bytes exist. What the rest of a spread's call is, which
 * only Svelte's own output holds. What a class or style decision's outcomes are, which needs the
 * scoping hash Svelte appends inside the attribute. And whether a component writes the markup it
 * was handed, which needs a second render made to ask exactly that.
 */

/**
 * Finishes each spread's expression by reading the call Svelte compiled for that element.
 *
 * Everything after the object -- the scoping hash, the class and style directives, and the flags
 * for a namespaced, case-preserving or input element -- is decided by the element rather than by
 * its attributes, so replacing the attributes leaves all of it in place. It is taken from the
 * output verbatim, which is the difference between borrowing a rule and having one.
 */
export function filled(baseline: Rewritten, file: string, root: string): void {
	if (baseline.spreads.length === 0) return;
	const code = compile(baseline.rewritten, {
		generate: 'server',
		name: 'Entry',
		filename: file,
		rootDir: root,
	}).js.code;
	const seen = new Map<Copy, string>();
	const compiled = (copy: Copy, at: string): string => {
		const held = seen.get(copy);
		if (held !== undefined) return held;
		const out = compile(copy.source, {
			generate: 'server',
			name: basename(copy.file, '.svelte'),
			filename: copy.file,
			rootDir: at,
		}).js.code;
		seen.set(copy, out);
		return out;
	};

	for (const one of baseline.spreads) {
		const rest = restOf(one.copy === null ? code : compiled(one.copy, root), probe(one.index));
		if (rest === null) {
			refuse(
				'an element whose attributes a `{...}` decides was planted and Svelte compiled no call ' +
					'to write them, which is this compiler rather than the component',
			);
		}
		const hole = baseline.holes[one.index];
		if (hole !== undefined) hole.expression = `attributes(${one.object}${rest})`;
	}
}

/**
 * The arguments after the first, from the `$.attributes(...)` call whose object holds this key.
 *
 * Read by scanning rather than by parsing: what is wanted is the source of those arguments,
 * unchanged, and the shortest way to keep it unchanged is not to take it apart.
 */
function restOf(code: string, key: string): string | null {
	const CALL = '$.attributes(';
	for (let at = code.indexOf(CALL); at >= 0; at = code.indexOf(CALL, at + 1)) {
		let depth = 0;
		let quote: string | null = null;
		let first = -1;
		for (let i = at + CALL.length - 1; i < code.length; i++) {
			const c = code[i];
			if (quote !== null) {
				if (c === '\\') i += 1;
				else if (c === quote) quote = null;
				continue;
			}
			if (c === '"' || c === "'" || c === '`') {
				quote = c;
				continue;
			}
			if (c === '(' || c === '{' || c === '[') depth += 1;
			else if (c === ')' || c === '}' || c === ']') {
				depth -= 1;
				if (depth === 0) {
					const text = code.slice(at + CALL.length, i);
					if (!text.includes(key)) break;
					return first < 0 ? '' : text.slice(first);
				}
			} else if (c === ',' && depth === 1 && first < 0) {
				first = i - (at + CALL.length);
			}
		}
	}
	return null;
}

/**
 * Which components write the markup they were handed, asked by rendering a second time.
 *
 * A component compiles to a plain call with no anchor around what it writes, so a marker planted
 * in what it was given and not coming back has two readings: the component never rendered that
 * markup, which is ordinary and correct -- a portal is client-only, and Svelte's own server writes
 * nothing for it -- or something took the value, which is content lost. **Absence cannot tell them
 * apart, and neither can it tell either from a compiler that has stopped working.**
 *
 * So absence is never the evidence. The same render is made again with a literal nobody could
 * produce inserted at the head of each group the markup arrives as, and the literal coming back is
 * what says the component writes that group. Only where it does not are the holes inside allowed
 * to go unconsumed, and the blocks to leave the order.
 *
 * **Inserted rather than put in place of the markup**, which is what makes one render answer for
 * every group at every depth: the walk is the baseline's walk, so a group nested inside another
 * one still carries its own literal and still renders exactly what the baseline rendered.
 *
 * The reading that keeps this honest: **a marker missing where the probe came back stays an
 * error**, and a probe missing where the whole mechanism has broken is what the surface checks
 * for a wrapper around markup are for. See spec/refusals.md.
 */
export async function probed(
	baseline: Rewritten,
	source: string,
	file: string,
	root: string,
	streams: readonly string[],
	fixed: ReadonlyMap<string, string> = new Map(),
	given: Record<string, unknown> = {},
	decided: ReadonlyMap<string, boolean> = new Map(),
): Promise<void> {
	if (baseline.handed.length === 0) return;
	const second = rewrite(
		source,
		(_block, branch) => branch === 0,
		file,
		root,
		true,
		fixed,
		decided,
	);
	let seen: string;
	try {
		const rendered = await renderRewritten(file, second.rewritten, root, second.copies, given);
		seen = rendered.body + rendered.head;
	} catch {
		// The probe could not be made, so nothing is known and nothing is relaxed. That is the safe
		// direction and not a quiet pass: a hole inside handed markup that does not come back is
		// then reported the way any other missing hole is, which is a worse message about a real
		// problem rather than a compile that skipped a check.
		return;
	}

	const text = streams.join('');
	for (const one of baseline.handed) {
		if (seen.includes(one.probe)) continue;

		// It writes none of it, so what was planted there was never going to come back. Anything
		// that did is a contradiction rather than a relaxation.
		for (let at = one.holes[0]; at < one.holes[1]; at++) {
			const hole = baseline.holes[at];
			if (hole === undefined) continue;
			if (text.includes(sentinel(at))) {
				refuse(
					`${one.what} writes none of the markup it is given, and something from that markup ` +
						'came back anyway. Two things that cannot both be true, so this is the compiler ' +
						'rather than the component',
				);
			}
			hole.safe = true;
		}
		for (let at = one.blocks[0]; at < one.blocks[1]; at++) {
			const block = baseline.blocks[at];
			if (block !== undefined) block.absent = true;
		}
	}
}

/**
 * Fills in each class decision's outcomes, which needs the render because it needs the hash.
 *
 * The scoping class is a hash of the filename relative to `rootDir` and of the stylesheet, and
 * Svelte appends it inside the class attribute itself. Reproducing it here would be a third place
 * that has to agree; reading it off the render is one. The marker stands as the whole class value,
 * so whatever follows it inside the quotes is the hash and nothing else.
 */
export async function outcomes(
	holes: Hole[],
	pending: readonly PendingChoice[],
	streams: readonly string[],
): Promise<void> {
	if (pending.length === 0) return;
	const { attr_class } = await import('svelte/internal/server');

	const { attr_style } = await import('svelte/internal/server');

	for (const one of pending) {
		const marker = sentinel(one.index);
		let hash: string | undefined;
		let found = false;
		for (const stream of streams) {
			const start = stream.indexOf(marker);
			if (start < 0) continue;
			const close = stream.indexOf('"', start);
			if (close < 0) continue;
			const after = stream.slice(start + marker.length, close);
			hash = after.startsWith(' ') ? after.slice(1) : undefined;
			found = true;
			break;
		}
		// A decision inside markup a component does not render is absent like everything else there.
		if (!found && holes[one.index]?.safe === true) continue;
		if (!found) {
			// Not a fault in the decision. The usual cause is a component that was given markup and
			// rendered none of it -- a closed dialog, a collapsed panel -- which is what Svelte's own
			// server does with it and which leaves everything planted inside with nowhere to come
			// back from. See spec/refusals.md.
			refuse(
				`the ${one.kind} decision on this element was planted and no render brought ` +
					'it back. Markup this element sits inside was given to a component that rendered ' +
					'none of it, so there is nothing here to choose between',
			);
		}
		const table: string[] = [];
		if (one.kind === 'class') {
			for (let bits = 0; bits < 1 << one.names.length; bits++) {
				const directives: Record<string, boolean> = {};
				for (const [at, name] of one.names.entries()) directives[name] = ((bits >> at) & 1) === 1;
				table.push(attr_class(one.base, hash, directives));
			}
		} else {
			const declarations = one.declarations ?? [];
			const some = declarations.some((each) => each.important);
			for (let bits = 0; bits < 1 << one.tests.length; bits++) {
				const normal: Record<string, unknown> = {};
				const important: Record<string, unknown> = {};
				let test = 0;
				for (const each of declarations) {
					const bag = each.important ? important : normal;
					if (each.expression === null) {
						bag[each.name] = each.literal;
						continue;
					}
					const present = ((bits >> test) & 1) === 1;
					test += 1;
					if (!present) {
						bag[each.name] = null;
						continue;
					}
					// A marker of its own per outcome, so a value in half the outcomes is still a
					// hole planted once and consumed once.
					const at = holes.length;
					holes.push({ index: at, expression: each.expression, raw: false });
					bag[each.name] = sentinel(at);
				}
				table.push(attr_style(one.base, some ? [normal, important] : normal));
			}
		}
		const hole = holes[one.index];
		if (hole?.choice !== undefined) hole.choice.outcomes = table;
	}
}

/**
 * Which values do not reach the bytes at all, asked by rendering again with different ones.
 *
 * A marker that does not come back has two readings, and they are not the same fault. The
 * component may have *transformed* it -- computed with it, measured it, branched on it -- which is
 * content lost and has to be refused. Or the value may simply not be written: a language switcher
 * hands its menu a source language, and the menu is a dropdown that is closed, so Svelte's own
 * server writes the trigger and nothing else. The second is not a fault at all, and refusing it
 * refuses a page that would have been correct.
 *
 * **Absence cannot tell them apart, so absence is not the evidence.** The same render is made
 * again with a different value in each of those places, and the two outputs are compared. Identical
 * bytes say the value reaches none of them; a difference says it reaches some, which is the first
 * reading and stays refused.
 *
 * The sentinels are swapped in the rewritten source rather than walked for again: each is a token
 * nothing else can produce, so replacing the text is exact, and the walk that produced them is not
 * something to run twice. The replacement differs in length as well as in content, because a
 * component that writes what it measured would otherwise agree by accident.
 *
 * This carries the same exposure the handed-markup probe does, and it is worth naming: what a
 * component writes at compile time is what it writes for the render it was given, and a subtree
 * that stays closed there stays closed at request time for the same reason -- it is client state,
 * false on the server both times. See spec/refusals.md.
 */
export async function dead(
	baseline: Rewritten,
	file: string,
	root: string,
	given: Record<string, unknown>,
	seen: { body: string; head: string },
	streams: readonly string[],
): Promise<void> {
	const missing = baseline.holes.filter(
		(hole) => hole.safe !== true && !streams.some((one) => one.includes(sentinel(hole.index))),
	);
	if (missing.length === 0) return;

	// All of them at once first, which is the common answer and one render. Where that says
	// something reaches the bytes it does not say which, and one live value would otherwise keep
	// every dead one beside it refused -- so the ones that are left are asked one at a time. On a
	// real route that was the difference between naming the component that ate a value and naming
	// the one that merely never wrote it.
	if (await unwritten(baseline, file, root, given, seen, missing)) {
		for (const hole of missing) hole.safe = true;
		return;
	}
	if (missing.length === 1) return;
	for (const hole of missing) {
		if (await unwritten(baseline, file, root, given, seen, [hole])) hole.safe = true;
	}
}

/** Whether the render is the same bytes with a different value in each of these places. */
async function unwritten(
	baseline: Rewritten,
	file: string,
	root: string,
	given: Record<string, unknown>,
	seen: { body: string; head: string },
	holes: readonly Hole[],
): Promise<boolean> {
	const swap = (text: string): string =>
		holes.reduce((held, hole) => held.replaceAll(sentinel(hole.index), other(hole.index)), text);
	try {
		const again = await renderRewritten(
			file,
			swap(baseline.rewritten),
			root,
			baseline.copies.map((copy) => ({ ...copy, source: swap(copy.source) })),
			given,
		);
		return again.body === seen.body && again.head === seen.head;
	} catch {
		// Nothing is known, so nothing is relaxed and the value is reported as before.
		return false;
	}
}

/** A value in the same shape as a sentinel and different from it in every way that could be read. */
function other(index: number): string {
	return `%%z${String(index)}z%%`;
}
