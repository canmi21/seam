/**
 * What keeps the dev server right: the log of what it compiled and where it disagreed with Kit's
 * render, the ladder a fault climbs, and the line it prints for a session. See spec/build.md, "How
 * it keeps itself right".
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { ViteDevServer } from 'vite';

/** What the dispatcher saw of one side of a disagreement: its bytes, or what it threw. */
export interface Answer {
	body?: string;
	head?: string;
	hashes?: string[];
	threw?: string;
}

/**
 * What the process holds across Vite's restarts, which make the plugin again in the same process:
 * the rung, when the last fault and the last restart were, and the session's counts.
 */
interface Kept {
	rung: number;
	lastFault: number;
	lastRestart: number;
	counts: {
		requests: number;
		refereed: number;
		disagreements: number;
		compiles: number;
		faults: Record<number, number>;
	};
	summarised: boolean;
}

const KEPT = Symbol.for('seam.dev.kept');
/** A fault more than this long after the last puts the ladder back on its first rung. */
const QUIET = 10 * 60_000;
/** Vite restarts at most once in this long, and a fault inside it ends the process. */
const RESTARTS = 60_000;

function kept(): Kept {
	const global = globalThis as Record<symbol, Kept | undefined>;
	global[KEPT] ??= {
		rung: 1,
		lastFault: 0,
		lastRestart: 0,
		counts: { requests: 0, refereed: 0, disagreements: 0, compiles: 0, faults: {} },
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

	get counts(): Kept['counts'] {
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

	/** A disagreement, with both answers written beside the log; the number it was given. */
	disagreed(key: string, ours: Answer, kit: Answer): number {
		const counts = kept().counts;
		counts.disagreements += 1;
		const n = counts.disagreements;
		const at = (side: string): string =>
			resolve(dirname(this.#log()), 'dev', `disagreed-${String(n)}.${side}.txt`);
		try {
			mkdirSync(dirname(at('ours')), { recursive: true });
			writeFileSync(at('ours'), shown(ours));
			writeFileSync(at('kit'), shown(kit));
		} catch {
			// As above.
		}
		this.write(`disagreed ${String(n)} ${key}: ${parted(ours, kit)}`);
		return n;
	}

	/**
	 * A fault, one rung up the ladder: this compiler starts over (`reset`), then Vite restarts, then
	 * the process ends. A restart inside a minute of the last one is not made; the process ends
	 * instead, since a server that keeps restarting is a loop somebody has to kill by hand.
	 */
	async fault(reason: string, reset: () => Promise<void>): Promise<void> {
		const state = kept();
		const now = Date.now();
		if (now - state.lastFault > QUIET) state.rung = 1;
		state.lastFault = now;
		let rung = state.rung + 1;
		if (rung === 3 && now - state.lastRestart < RESTARTS) rung = 4;
		state.rung = Math.min(rung, 4);
		state.counts.faults[state.rung] = (state.counts.faults[state.rung] ?? 0) + 1;
		const where = `The log is ${this.#log()}.`;
		this.write(`fault, rung ${String(state.rung)}: ${reason}`);
		const logger = this.#server.config.logger;
		if (state.rung === 2) {
			logger.error(`seam: ${reason}. Starting the compile over. ${where}`, { timestamp: true });
			await reset();
			return;
		}
		if (state.rung === 3) {
			logger.error(`seam: ${reason}, after starting over. Restarting the dev server. ${where}`, {
				timestamp: true,
			});
			state.lastRestart = now;
			await this.#server.restart();
			return;
		}
		logger.error(
			`seam: ${reason}, after the dev server restarted. Stopping it: this is a fault of the compiler's, not of the project's. ${where}`,
			{ timestamp: true },
		);
		process.exit(1);
	}

	/** The session in one line, which an author running it for a week reads to know how it went. */
	summary(): string {
		const { counts } = kept();
		const faults = [2, 3, 4].map(
			(rung) => `${String(counts.faults[rung] ?? 0)} at rung ${String(rung)}`,
		);
		return (
			`seam: this session answered ${String(counts.requests)} request(s), held ${String(counts.refereed)} ` +
			`render(s) to Kit's, disagreed ${String(counts.disagreements)} time(s), compiled ` +
			`${String(counts.compiles)} time(s); faults: ${faults.join(', ')}. The log is ${this.#log()}.`
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
