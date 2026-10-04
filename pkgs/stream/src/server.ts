/**
 * What a page's render left unsettled, streamed into the same response once it settles.
 *
 * Kit writes into a page the queries its render started and did not await only where they have
 * settled by the time the render ends, and leaves the rest for the client to fetch after it
 * hydrates. Here the rest go into the response as well, after the page: the page is sent as it
 * is, and each value follows in a script of its own as it settles, so neither the page waits on a
 * query nor the client asks for one the server was already computing. The fork calls this from
 * `render.js` and `collect_remote_data`. See spec/framework.md, "What a render left unsettled is
 * streamed after the page".
 */

/** The kinds of entry streamed: a query, and a live query's first value. */
export const STREAMED: readonly string[] = ['q', 'l'];

/**
 * How long a value is waited for once the page has gone, in milliseconds. One that has not settled
 * by then is handed to the client to fetch, as Kit hands it at once: a live query that never yields
 * would otherwise hold the response open for as long as the connection lasted.
 */
export const LIMIT = 10_000;

export interface Options {
	/** The page's global, `__sveltekit_<hash>`, which the boot script declares. */
	global: string;
	/** A script's opening tag as the page writes one, its nonce included. */
	open: string;
	/** Kit's serializer, the one `${global}.data` is written with, transport encoders included. */
	uneval: (value: unknown) => string;
	/**
	 * What a rejection becomes on the client, as Kit makes it for one that settled in time: the
	 * result of `handle_error_and_jsonify`. Null for one Kit does not write, a redirect.
	 */
	convert: (error: unknown) => Promise<unknown>;
	/** See `LIMIT`. */
	limit?: number;
}

export interface Streaming {
	/**
	 * One of the entries `collect_remote_data` looked at. Every one is offered; which are streamed
	 * is decided by `declare`, once the data Kit writes is known.
	 */
	add(type: string, key: string, promise: PromiseLike<unknown>): void;
	/**
	 * The script that declares what is coming, for the boot script, or `''` where nothing is: for
	 * each entry offered that Kit's `data` does not hold, a promise the client's query waits on
	 * instead of fetching. Synchronous, and ahead of the boot script's own import, so that a value
	 * streamed before Kit's client has loaded is held rather than lost.
	 */
	declare(data: Readonly<Record<string, Readonly<Record<string, unknown>> | undefined>>): string;
	/** Kit's own chunks with this response's beside them, each sent as it settles. */
	with(chunks: AsyncIterable<string> | null): AsyncIterable<string> | null;
}

interface Offered {
	type: string;
	key: string;
	promise: PromiseLike<unknown>;
}

/** Text that goes inside a script, with nothing in it that could close the script. */
function scripted(text: string): string {
	let out = text.replace(/</g, '\\u003C');
	// The two line terminators JSON allows in a string and a script does not, by code point.
	for (const code of [0x2028, 0x2029]) {
		out = out.replaceAll(String.fromCharCode(code), `\\u${code.toString(16)}`);
	}
	return out;
}

export function streaming(options: Options): Streaming {
	const offered: Offered[] = [];
	let streamed: Promise<string>[] = [];

	/** The script that settles entry `id` on the client, once its value is known. */
	const settled = async (id: number, promise: PromiseLike<unknown>): Promise<string> => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const late = new Promise<{ late: true }>((done) => {
			timer = setTimeout(() => done({ late: true }), options.limit ?? LIMIT);
		});
		let made: string;
		try {
			const outcome = await Promise.race([
				Promise.resolve(promise).then(
					(value) => ({ value }),
					(error: unknown) => ({ error }),
				),
				late,
			]);
			if ('late' in outcome) {
				made = 'null';
			} else if ('error' in outcome) {
				const converted = await options.convert(outcome.error);
				made = converted === null ? 'null' : options.uneval({ e: converted });
			} else {
				made = options.uneval({ v: outcome.value });
			}
		} catch {
			// A value the serializer refuses goes to the client to fetch, which reports it there.
			made = 'null';
		} finally {
			clearTimeout(timer);
		}
		return `${options.open}${options.global}.settle(${String(id)}, (app) => (${made}))</script>\n`;
	};

	return {
		add(type, key, promise) {
			if (STREAMED.includes(type)) offered.push({ type, key, promise });
		},

		declare(data) {
			const pending = offered.filter(
				({ type, key }) => data[type] === undefined || !Object.hasOwn(data[type], key),
			);
			if (pending.length === 0) return '';
			const listed = pending.map(({ type, key }, at) => [type, key, at + 1]);
			streamed = pending.map(({ promise }, at) => settled(at + 1, promise));
			return scripted(
				`{ const g = ${options.global}, s = new Map(); g.streamed = {}; ` +
					`for (const [t, k, i] of ${JSON.stringify(listed)}) ` +
					'(g.streamed[t] ??= {})[k] = new Promise((r) => s.set(i, r)); ' +
					'g.settle = (i, f) => { s.get(i)?.(f); s.delete(i); }; }',
			);
		},

		with(chunks) {
			if (streamed.length === 0) return chunks;
			const ours = inOrder(streamed);
			return chunks === null ? ours : merged(chunks, ours);
		},
	};
}

/** Strings as each of their promises settles, first settled first. */
async function* inOrder(promises: readonly Promise<string>[]): AsyncIterable<string> {
	const waiting = new Map(promises.map((one, at) => [at, one.then((text) => ({ at, text }))]));
	while (waiting.size > 0) {
		const { at, text } = await Promise.race(waiting.values());
		waiting.delete(at);
		yield text;
	}
}

/** Two streams as one, each item as soon as either has it. */
async function* merged(
	first: AsyncIterable<string>,
	second: AsyncIterable<string>,
): AsyncIterable<string> {
	const sources = [first[Symbol.asyncIterator](), second[Symbol.asyncIterator]()];
	const next = (at: number): Promise<{ at: number; step: IteratorResult<string> }> =>
		(sources[at] as AsyncIterator<string>).next().then((step) => ({ at, step }));
	const waiting = new Map([
		[0, next(0)],
		[1, next(1)],
	]);
	while (waiting.size > 0) {
		const { at, step } = await Promise.race(waiting.values());
		if (step.done === true) {
			waiting.delete(at);
			continue;
		}
		waiting.set(at, next(at));
		yield step.value;
	}
}
