/**
 * What the dev server's check keeps: the log of what it compiled, what it found the build will render
 * by SSR and where it disagreed with Kit's render, what a fault did, and the line it prints for a
 * session. See spec/build.md, "How it keeps itself right".
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { stringify } from 'devalue';
import type { ViteDevServer } from 'vite';

/** What one side of a check came to: its bytes, or what it threw. */
export interface Answer {
	body?: string;
	head?: string;
	hashes?: string[];
	threw?: string;
}

/** The session's counts, kept on the framework's global so a Vite restart does not lose them. */
interface Counts {
	checked: number;
	disagreements: number;
	compiles: number;
	faults: number;
	ssr: number;
	/** Payloads devalue could not write, which the build cannot replay. */
	unwritable: number;
}

const KEPT = Symbol.for('seam.dev.kept');

function kept(): { counts: Counts; summarised: boolean } {
	const global = globalThis as Record<symbol, { counts: Counts; summarised: boolean } | undefined>;
	global[KEPT] ??= {
		counts: { checked: 0, disagreements: 0, compiles: 0, faults: 0, ssr: 0, unwritable: 0 },
		summarised: false,
	};
	return global[KEPT];
}

export class Keeping {
	readonly #server: ViteDevServer;
	readonly #log: () => string;

	/** `log` is where the log is, which is known once Kit's config has been read. */
	constructor(server: ViteDevServer, log: () => string) {
		this.#server = server;
		this.#log = log;
		const state = kept();
		// Said once a process, however many times Vite restarts within it.
		if (!state.summarised) {
			state.summarised = true;
			process.once('exit', () => {
				console.log(this.summary());
			});
		}
	}

	get counts(): Counts {
		return kept().counts;
	}

	/** A line into the log, timestamped. */
	write(line: string): void {
		try {
			mkdirSync(dirname(this.#log()), { recursive: true });
			appendFileSync(this.#log(), `${new Date().toISOString()} ${line}\n`);
		} catch {
			// The log is for reading afterwards; a log that cannot be written stops nothing.
		}
	}

	/**
	 * A disagreement, with both answers and the props written beside the log, the props in devalue as
	 * Kit writes data, so the case can be run again; the number it was given.
	 */
	disagreed(key: string, ours: Answer, kit: Answer, payload: Record<string, unknown>): number {
		const counts = kept().counts;
		counts.disagreements += 1;
		const n = counts.disagreements;
		const at = (side: string): string =>
			resolve(dirname(this.#log()), 'dev', `disagreed-${String(n)}.${side}`);
		try {
			mkdirSync(dirname(at('ours.txt')), { recursive: true });
			writeFileSync(at('ours.txt'), shown(ours));
			writeFileSync(at('kit.txt'), shown(kit));
			let props: string;
			try {
				props = stringify(payload);
			} catch (error) {
				props = `not written: ${String((error as Error).message)}`;
			}
			writeFileSync(at('props.devalue'), props);
		} catch {
			// As above.
		}
		this.write(`disagreed ${String(n)} ${key}: ${parted(ours, kit)}`);
		return n;
	}

	/**
	 * A fault: the compile starts over (`reset`), and nothing more, since Kit's render answers every
	 * request whatever the check says. See spec/build.md, "How it keeps itself right".
	 */
	async fault(reason: string, reset: () => Promise<void>): Promise<void> {
		kept().counts.faults += 1;
		this.write(`fault: ${reason}; starting the compile over`);
		this.#server.config.logger.error(
			`seam: ${reason}. Starting the compile over. The log is ${this.#log()}.`,
			{ timestamp: true },
		);
		await reset();
	}

	/** The session in one line, which an author running it for a week reads to know how it went. */
	summary(): string {
		const { counts } = kept();
		return (
			`seam: this session held ${String(counts.checked)} render(s) to Kit's and disagreed ` +
			`${String(counts.disagreements)} time(s), compiled ${String(counts.compiles)} time(s), ` +
			`started over ${String(counts.faults)} time(s), found ${String(counts.ssr)} part(s) of routes the ` +
			`build renders by SSR, and could not keep ${String(counts.unwritable)} payload(s) for the ` +
			`build to replay. The log is ${this.#log()}.`
		);
	}
}

function shown(answer: Answer): string {
	if (answer.threw !== undefined) return `threw\n${answer.threw}\n`;
	return `head\n${answer.head ?? ''}\n\nbody\n${answer.body ?? ''}\n\nhashes\n${JSON.stringify(answer.hashes ?? [])}\n`;
}

/** Where two answers part, in a line. */
function parted(ours: Answer, kit: Answer): string {
	if (ours.threw !== undefined || kit.threw !== undefined) {
		return `ours ${ours.threw === undefined ? 'wrote' : 'threw'}, Kit's ${kit.threw === undefined ? 'wrote' : 'threw'}`;
	}
	for (const part of ['head', 'body'] as const) {
		const a = ours[part] ?? '';
		const b = kit[part] ?? '';
		if (a === b) continue;
		let at = 0;
		while (at < a.length && a[at] === b[at]) at += 1;
		return `the ${part} parts at ${String(at)}: ours ${JSON.stringify(a.slice(at, at + 60))}, Kit's ${JSON.stringify(b.slice(at, at + 60))}`;
	}
	return 'the script hashes differ';
}
