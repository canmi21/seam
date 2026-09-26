/**
 * One case of the refusal surface, and what every case's source opens with. The cases are the
 * files beside this one, by topic; `skeleton.test.ts` runs them. See spec/refusals.md.
 */
export interface Case {
	name: string;
	source: string;
	/**
	 * The payloads the shape turns on. An each block needs an empty list as well as a full one, an
	 * if needs both branches: a construct only has to be wrong on the payload nobody tried.
	 */
	data?: unknown[];
	/**
	 * Whole props objects, where the case is about a prop that is not `data`.
	 *
	 * `data` above is the usual shape and covers the payload a route has. A default on one of the
	 * entry's own props needs the other half as well -- the request that leaves the prop out and the
	 * one that sends it -- and neither is expressible as a value of `data`, since `data` is always
	 * passed. Given, these are the payloads instead of `data`'s.
	 */
	props?: Record<string, unknown>[];
	/** Sibling files the case imports, by name without the extension. Composition needs two. */
	beside?: Record<string, string>;
	/** Sibling files that are not components, written as named. What a derivation may call. */
	alongside?: Record<string, string>;
	/** Files under the case's own `node_modules`, by path there: a package the case imports. */
	installed?: Record<string, string>;
	/**
	 * Payload paths this render is fixed at, as literal source text. The payloads below have to
	 * agree with them, since the oracle is given the whole of the data and renders what it says.
	 */
	fixed?: Record<string, string>;
	/**
	 * What the refusal has to say, where saying the right thing is the point of the case.
	 *
	 * Most refusals are checked only for existing, because the message is prose and pinning prose
	 * makes a test that fails when somebody improves it. This is for the ones where *which* thing
	 * the message names is the behaviour under test.
	 */
	says?: string;
	/** The render option both sides are handed, where the case is a boundary that catches. */
	transformError?: (error: unknown) => unknown;
}

export const PROPS = '<script>let { data } = $props()</script>';
