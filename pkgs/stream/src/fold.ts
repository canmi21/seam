/**
 * A response with what `./server.ts` streams taken out of it, and the same entries taken out of
 * Kit's: what a page that streams is held to. It is one of spec/conformance.md's declared
 * differences, and this is its check: everything but when the streamed entries arrive is Kit's,
 * byte for byte. Beside the format it reads, so that the two change together.
 *
 * For the checks only: it evaluates the expression a page writes its remote data in, so it is
 * handed a response of a build one made oneself, never one from elsewhere.
 */
import { uneval } from 'devalue';

const GLOBAL = String.raw`__sveltekit_[A-Za-z0-9_<>]+`;

/** The declaration `declare` writes into the boot script, with the separator after it. */
const DECLARED = new RegExp(
	String.raw`\{ const g = ${GLOBAL}, s = new Map\(\); g\.streamed = \{\}; for \(const \[t, k, i\] of (\[.*?\])\) .*?g\.settle = \(i, f\) => \{ s\.get\(i\)\?\.\(f\); s\.delete\(i\); \}; \}\n\n\t{5}`,
);

/** A script a streamed value arrives in. */
const SETTLED = new RegExp(
	String.raw`<script[^>]*>${GLOBAL}\.settle\(\d+, \(app\) => \([\s\S]*?\)\)</script>\n`,
	'g',
);

/** The statement Kit writes its remote data in, which `render.js` follows with this whitespace. */
const DATA = new RegExp(String.raw`(${GLOBAL})\.data = ([\s\S]*?);\n\n\t{6}`);

/** The entries a response of ours streamed, as `[type, key]`. None for a response that streams none. */
export function streamedIn(text: string): [string, string][] {
	const found = DECLARED.exec(text);
	if (found === null) return [];
	return (JSON.parse(found[1] ?? '[]') as [string, string, number][]).map(([type, key]) => [
		type,
		key,
	]);
}

/**
 * The response without what was streamed: the declaration and the scripts of a response of ours,
 * and the entries in `streamed` from Kit's remote data, which is written again without them --
 * and not at all where nothing is left, as Kit leaves it out. Applied to Kit's response and to ours
 * alike, so that both come out written the same way.
 */
export function withoutStreamed(text: string, streamed: readonly [string, string][]): string {
	if (streamed.length === 0) return text;
	let bare = text.replace(DECLARED, '').replace(SETTLED, '');
	// A response that streams is the page and a newline, then the scripts (`stream_text`); with
	// nothing of Kit's own streamed after the page, the newline is ours too.
	const end = bare.lastIndexOf('</html>');
	const tail = end < 0 ? '' : bare.slice(end + '</html>'.length);
	if (end >= 0 && text !== bare && /^\s*\n$/.test(tail)) bare = bare.slice(0, -1);
	const found = DATA.exec(bare);
	if (found === null) return bare;
	let data: Record<string, Record<string, unknown>>;
	try {
		// A custom transporter's value is written as `app.decode(...)`, read back here as a record of
		// the call, which is written again the same way on both sides.
		const decode = (type: string, value: unknown): unknown => ({ decoded: type, value });
		// eslint-disable-next-line no-new-func
		data = new Function('app', `return (${found[2] ?? 'undefined'});`)({ decode }) as typeof data;
	} catch {
		return bare;
	}
	for (const [type, key] of streamed) {
		const entries = data[type];
		if (entries === undefined) continue;
		delete entries[key];
		if (Object.keys(entries).length === 0) delete data[type];
	}
	const rest =
		Object.keys(data).length === 0
			? ''
			: `${found[1] ?? ''}.data = ${uneval(data)};\n\n\t\t\t\t\t\t`;
	return bare.replace(found[0], rest);
}
