#!/usr/bin/env node
/**
 * `npm create seamjs [dir]`: asks where the project goes, unless it was given, and which adapter
 * it builds for, then writes it. See spec/publish.md, "`create-seamjs`".
 */
import { createInterface } from 'node:readline';
import { relative } from 'node:path';
import { ADAPTERS, type Adapter, scaffold, usable } from './scaffold.ts';

const DEFAULT_DIR = 'seam-app';

const prompt = createInterface({ input: process.stdin, output: process.stdout });
// Read as a stream of lines rather than one `question()` at a time: answers piped in arrive together,
// and a line that comes before its question is asked is otherwise dropped.
const lines = prompt[Symbol.asyncIterator]();

/** Asks until `accept` takes the answer, which it returns, or returns what to say instead. */
async function ask<T extends string>(
	question: string,
	fallback: T,
	accept: (answer: string) => T | string,
): Promise<T> {
	for (;;) {
		process.stdout.write(`${question} (${fallback}): `);
		const next = await lines.next();
		// Input that has ended answers with the default, and has nothing left to answer a retry.
		if (next.done === true) process.stdout.write('\n');
		const answer = (next.done === true ? '' : String(next.value)).trim() || fallback;
		const taken = accept(answer);
		if (taken === answer) return answer as T;
		if (next.done === true) throw new Error(taken);
		console.log(taken);
	}
}

try {
	const given = process.argv[2];
	const dir =
		given ??
		(await ask('Where should the project go?', DEFAULT_DIR, (answer) =>
			usable(answer) ? answer : `${answer} is not empty; pick another directory.`,
		));
	if (!usable(dir)) throw new Error(`${dir} is not empty`);
	const adapter = await ask<Adapter>(`Adapter, ${ADAPTERS.join(' or ')}?`, 'none', (answer) =>
		(ADAPTERS as readonly string[]).includes(answer)
			? answer
			: `Pick one of ${ADAPTERS.join(', ')}.`,
	);
	scaffold({ dir, adapter });

	// The package manager that ran this, so the next steps are in its words.
	const manager = process.env['npm_config_user_agent']?.split('/')[0] ?? 'npm';
	const at = relative(process.cwd(), dir) || '.';
	console.log(`\nWritten to ${at}. Next:\n`);
	if (at !== '.') console.log(`  cd ${at}`);
	console.log(`  ${manager} install`);
	console.log(`  ${manager} run build`);
	console.log(`  ${manager} run preview\n`);
} catch (error) {
	console.error((error as Error).message);
	process.exitCode = 1;
} finally {
	prompt.close();
}
