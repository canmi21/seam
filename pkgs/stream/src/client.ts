/**
 * The client's half of `./server.ts`: a query the page declared as coming waits for its value
 * instead of fetching it. Called from the fork's client: `_start`, and the constructors of a query
 * and a live query. See spec/framework.md, "What a render left unsettled is streamed after the
 * page".
 */

/** What a streamed script hands over: a node as Kit writes one, or null for "fetch it yourself". */
export type Settle = (app: unknown) => { v?: unknown; e?: unknown } | null;

/** The page's global, as far as this reads it. */
interface Streamed {
	streamed?: Record<string, Record<string, Promise<Settle>>>;
}

/**
 * Every entry the page declared as coming, put where Kit puts the entries it wrote, as
 * `{ streamed }` beside Kit's `{ v }` and `{ e }`: a name the minifier keeps, which is how
 * `mise run compare` tells a client chunk carrying these call points from Kit's own. An entry Kit wrote is left as it is.
 */
export function seeded(payload: Streamed, responses: Record<string, unknown>): void {
	for (const entries of Object.values(payload.streamed ?? {})) {
		for (const [key, promise] of Object.entries(entries)) {
			if (!Object.hasOwn(responses, key)) responses[key] = { streamed: promise };
		}
	}
}

/**
 * A query's fetch, whose first call waits for the streamed value instead: the value, or the error
 * as `failed` makes it -- what Kit's query does with a written `{ e }` -- or the fetch after all
 * where the server handed it over. Every later call fetches.
 */
export function first<T>(
	streamed: Promise<Settle>,
	app: () => unknown,
	fetch: () => Promise<T>,
	failed: (error: unknown) => unknown,
): () => Promise<T> {
	let used = false;
	return () => {
		if (used) return fetch();
		used = true;
		return streamed.then((settle) => {
			const node = settle(app());
			if (node === null) return fetch();
			if ('e' in node) throw failed(node.e);
			return node.v as T;
		});
	};
}

/**
 * A live query's first value, handed over as it arrives. A live query connects whether or not it
 * has one -- Kit's does after a written value too -- so this only fills the value in; `apply` is
 * left to keep the newer one where the connection has already delivered it.
 */
export function later(
	streamed: Promise<Settle>,
	app: () => unknown,
	apply: (node: { v?: unknown; e?: unknown }) => void,
): void {
	void streamed.then((settle) => {
		const node = settle(app());
		if (node !== null) apply(node);
	});
}
