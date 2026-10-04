/**
 * What two builds of one app are compared by: asking a server for a URL, writing out what two builds
 * differ in by construction, and pairing our client's files with Kit's by content. `compare.ts` runs
 * it over Kit's test apps; a local harness over one of the author's applications runs it too. See
 * spec/conformance.md, "Stage 2".
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface Answer {
	status: number;
	location: string;
	type: string;
	body: string;
}

/**
 * A body that names its own digest, read as whether it matches it: what Kit's own spec asks of it.
 * `basics`'s `/endpoint-output/stream` answers 256 KB of `randomBytes` per request with a
 * `digest: sha-256=<base64url>` header, so no two of its answers are the same bytes, Kit's included;
 * `server.spec.js`'s "body can be a binary ReadableStream" holds it to the digest instead. Null for
 * a response without one, which is compared as it is. See spec/conformance.md, "Stage 2".
 */
export function digested(header: string | null, bytes: Buffer): string | null {
	const named = header?.match(/^sha-256=(.+)$/)?.[1];
	if (named === undefined) return null;
	const made = createHash('sha256').update(bytes).digest('base64url');
	return made === named
		? `<${String(bytes.length)} bytes matching their sha-256 digest>`
		: `<${String(bytes.length)} bytes not matching their sha-256 digest>`;
}

export async function ask(port: number, url: string): Promise<Answer> {
	try {
		const response = await fetch(`http://localhost:${String(port)}${encodeURI(url)}`, {
			redirect: 'manual',
			headers: { accept: 'text/html' },
			// A page that never answers is reported as that rather than holding the run.
			signal: AbortSignal.timeout(10_000),
		});
		const bytes = Buffer.from(await response.arrayBuffer());
		return {
			status: response.status,
			location: response.headers.get('location') ?? '',
			type: response.headers.get('content-type') ?? '',
			body: digested(response.headers.get('digest'), bytes) ?? bytes.toString('utf8'),
		};
	} catch (error) {
		return { status: -1, location: '', type: '', body: String(error) };
	}
}

/** Kit's `outDir` for an app, which `options` moves to `.custom-out-dir`: the one holding a build. */
export function outDir(dir: string): string {
	const found = readdirSync(dir).find((one) =>
		existsSync(resolve(dir, one, 'output/server/manifest-full.js')),
	);
	if (found === undefined) throw new Error(`no build under ${dir}`);
	return resolve(dir, found);
}

/**
 * Where Kit's source sits, which an unminified bundle names in its `//#region` comments:
 * `vendor/kit` for Kit's build and `pkgs/framework` for the fork's, where an install of either puts
 * it in the same `node_modules/@sveltejs/kit`. `options-2` and `basics` build unminified.
 */
export function kitSource(text: string): string {
	return text.replace(/(?:\.\.\/)+(?:vendor\/kit|framework)\/src\//g, '<kit>/src/');
}

/**
 * A list of the client's chunks in the order the bundler emitted them, written in name order: what
 * `/service-worker.js` and Kit's build manifest list, one `{ "path": ... }` after another. The
 * order follows the hashes, which follow where Kit's source sits (see the top of this file), so
 * with ours renamed as Kit's the same list stood in another order. Only a run of entries with
 * nothing but the list between them is sorted: the chunks a page preloads stay in its order.
 */
export function listed(text: string): string {
	// A name, or the placeholder a chunk carrying the fork's client call points is read as.
	const chunk = /_app\/immutable\/chunks\/(?:[A-Za-z0-9_-]{8}|<client>)\.js/g;
	const between = /^"[\s{},]*"path":\s*"$/;
	const found = [...text.matchAll(chunk)];
	let out = '';
	let from = 0;
	for (let at = 0; at < found.length;) {
		let end = at;
		while (
			end + 1 < found.length &&
			between.test(
				text.slice((found[end]?.index ?? 0) + (found[end]?.[0].length ?? 0), found[end + 1]?.index),
			)
		) {
			end += 1;
		}
		if (end > at) {
			const run = found.slice(at, end + 1);
			const sorted = run.map((one) => one[0]).toSorted();
			for (const [i, one] of run.entries()) {
				out += text.slice(from, one.index) + (sorted[i] ?? one[0]);
				from = (one.index ?? 0) + one[0].length;
			}
		}
		at = end + 1;
	}
	return out + text.slice(from);
}

/** The version Kit named a build by, or null for an app with no client at all -- `csr` off everywhere. */
export function versionOf(dir: string): string | null {
	const file = resolve(outDir(dir), 'output/client/_app/version.json');
	return existsSync(file)
		? (JSON.parse(readFileSync(file, 'utf8')) as { version: string }).version
		: null;
}

/**
 * A chunk's imports by the names the module reads them under, in order, without the names the
 * bundler gave them on the way out of the chunk they come from: `import { N as load_css }`. Those
 * are its own mangling of that chunk's exports and follow its content, so a chunk carrying the
 * fork's client call points renames them for every chunk importing from it, whose code is otherwise
 * Kit's. What the module does with them is in its body, under the names kept here.
 */
export function imported(text: string): string {
	return text.replace(
		/import \{([^}]*)\} from/g,
		(_, list: string) =>
			`import { ${list
				.split(',')
				.map(
					(one) =>
						one
							.trim()
							.split(/\s+as\s+/)
							.at(-1) ?? '',
				)
				.filter((one) => one !== '')
				.toSorted()
				.join(', ')} } from`,
	);
}

/** A client file's name, as `[prefix.]<hash>.<extension>`, with the bundler's eight-character hash. */
export const HASHED = /^(?:(.+)\.)?([A-Za-z0-9_-]{8})\.([a-z0-9]+(?:\.map)?)$/;

/** Every file under a build's client output, by its path there. */
export function clientFiles(dir: string): Map<string, string> {
	const root = resolve(outDir(dir), 'output/client');
	const found = new Map<string, string>();
	const walk = (at: string): void => {
		for (const one of readdirSync(resolve(root, at), { withFileTypes: true })) {
			const path = at === '' ? one.name : `${at}/${one.name}`;
			// Vite's own manifest, which no page names, and whose `manifest.json` reads as a hash.
			if (one.isDirectory()) {
				if (path !== '.vite') walk(path);
			} else found.set(path, readFileSync(resolve(root, path), 'latin1'));
		}
	};
	walk('');
	return found;
}

/**
 * Our client's hashes written as Kit's, for every file of ours whose content is Kit's file's once
 * the hashes in both are written out, in the same directory under the same prefix; and the files
 * of ours that have no such pair, which are differences of their own. See the top of this file.
 *
 * Files alike once every hash is written out are told apart by the files they name: a pair found
 * is written back into both sides as one name, and the rest are keyed again, until nothing more
 * pairs. Two files that are alike even then are the same file twice, and stand for each other.
 */
export function paired(
	kitDir: string,
	seamDir: string,
): { names: Map<string, string>; kitNames: Map<string, string>; unpaired: string[] } {
	interface Hashed {
		hash: string;
		shape: string;
		content: string;
	}
	const read = (dir: string): Hashed[] => {
		const version = versionOf(dir);
		const found: Hashed[] = [];
		for (const [path, content] of clientFiles(dir)) {
			const name = path.split('/').at(-1) ?? '';
			const at = HASHED.exec(name);
			if (at === null) continue;
			const shape = `${path.slice(0, -name.length)}${at[1] ?? ''}.${at[3] ?? ''}`;
			// What the pages are read without, which a client file holds too: the version, and the
			// global Kit names after it.
			const normalized = imported(kitSource(content))
				.replaceAll(version ?? '\0', '<version>')
				.replace(/__sveltekit_[a-z0-9]+/g, '__sveltekit_<hash>');
			found.push({ hash: at[2] ?? '', shape, content: normalized });
		}
		return found;
	};
	const kit = read(kitDir);
	const ours = read(seamDir);
	const names = new Map<string, string>();
	const known = new Set<string>();
	// A name both builds gave is one file, as it was before any name was matched: the bundler hashed
	// the same content into it, and what was written into it afterwards -- the remote functions
	// Kit prerendered, in the order they finished -- is not this comparison's to read.
	for (const one of ours) {
		if (kit.some((other) => other.hash === one.hash && other.shape === one.shape)) {
			names.set(one.hash, one.hash);
			known.add(one.hash);
		}
	}
	const keyed = (
		files: Hashed[],
		as: (hash: string) => string | undefined,
	): Map<string, Hashed[]> => {
		const byKey = new Map<string, Hashed[]>();
		for (const file of files) {
			let content = file.content;
			for (const other of files)
				content = content.replaceAll(other.hash, as(other.hash) ?? '<hash>');
			const key = `${file.shape}\n${content}`;
			byKey.set(key, [...(byKey.get(key) ?? []), file]);
		}
		return byKey;
	};
	for (let moved = true; moved;) {
		moved = false;
		const theirs = keyed(kit, (hash) => (known.has(hash) ? hash : undefined));
		for (const [key, mine] of keyed(ours, (hash) => names.get(hash))) {
			const match = theirs.get(key);
			if (match === undefined || match.length !== 1 || mine.length !== 1) continue;
			const [one] = mine;
			const [other] = match;
			if (one === undefined || other === undefined || names.has(one.hash)) continue;
			names.set(one.hash, other.hash);
			known.add(other.hash);
			moved = true;
		}
	}
	const theirs = keyed(kit, (hash) => (known.has(hash) ? hash : undefined));
	const unpaired: string[] = [];
	for (const [key, mine] of keyed(ours, (hash) => names.get(hash))) {
		const left = mine.filter((one) => !names.has(one.hash));
		if (left.length === 0) continue;
		const match = (theirs.get(key) ?? []).filter((one) => !known.has(one.hash));
		if (match.length !== left.length) {
			// A file holding the fork's client call points differs from Kit's by them, as declared:
			// it and whatever of Kit's is left stand as one placeholder, so a page still has to name
			// it where Kit's names its own. Anything else unmatched is a difference.
			for (const one of left) {
				if (one.content.includes(CLIENT_MARK)) names.set(one.hash, CLIENT);
				else unpaired.push(`${key.split('\n')[0] ?? ''} (${one.hash})`);
			}
			continue;
		}
		const sorted = match.map((one) => one.hash).toSorted();
		left
			.map((one) => one.hash)
			.toSorted()
			.forEach((one, i) => names.set(one, sorted[i] ?? one));
	}
	const kitNames = new Map(
		kit.filter((one) => !known.has(one.hash)).map((one): [string, string] => [one.hash, CLIENT]),
	);
	return { names, kitNames, unpaired };
}

/**
 * What the fork's client call points carry into a chunk, which Kit's own client never says: the
 * property the page's declaration of what is coming is read from. See spec/conformance.md,
 * "Declared differences".
 */
export const CLIENT_MARK = 'streamed';

/** The name a chunk holding the fork's client call points, or Kit's one standing for it, is read as. */
export const CLIENT = '<client>';

/**
 * A client inlined into the page's boot script (`bundleStrategy: 'inline'`, as `options-3` builds),
 * read as the placeholder a chunk carrying the fork's client call points is read as: there the
 * whole of the client is one script in every page, and the call points are in it. Kit's is read so
 * wherever it is; ours only where it carries them, and is otherwise left to differ.
 */
export function inlined(text: string, carrying: boolean): string {
	return text.replace(
		/(document\.currentScript\.parentElement;\n\n\t{5})([\s\S]*?\/\/# sourceMappingURL=bundle\.[^\n]*?\.js\.map)/,
		(whole, before: string, client: string) =>
			carrying && !client.includes(CLIENT_MARK) ? whole : `${before}${CLIENT}`,
	);
}

/** What two builds of one app differ in by construction, written out of an answer. */
export function normaliser(
	dir: string,
	names: ReadonlyMap<string, string> = new Map(),
	ours = false,
): (answer: Answer) => string {
	const version = versionOf(dir);
	const renamed = (text: string): string => {
		if (names.size === 0) return text;
		return text.replace(/[A-Za-z0-9_-]{8}/g, (one) => names.get(one) ?? one);
	};
	return ({ status, location, type, body }) =>
		inlined(
			listed(kitSource(renamed([status, location, type, body].join('\n'))))
				.replaceAll(version ?? '\0', '<version>')
				.replace(/__sveltekit_[a-z0-9]+/g, '__sveltekit_<hash>')
				// The two servers listen on two ports, and a page may write the URL it was asked at.
				.replace(/localhost:479[123]/g, 'localhost:<port>')
				// What the app's own `load` functions read of the clock and of `Math.random()`, which
				// differs between any two answers and is not the render's.
				.replace(/\b1\d{12}\b/g, '<time>')
				.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, '<date>')
				.replace(/(?<!\d)0?\.\d{9,}/g, '<random>')
				// A content security policy's nonce, which Kit makes per request.
				.replace(/nonce="[A-Za-z0-9+/=]+"/g, 'nonce="<nonce>"')
				// A hashed file name, under `_app/immutable` or wherever an inlined bundle names its map.
				// From the start of a name and no longer than one: unanchored, `[\w-]+` was retried from
				// every position of a long run of word characters, which held a run of `basics` at full
				// CPU for half an hour and was taken at first for a page that never answered.
				.replace(
					/(?<![\w-])([\w-]{1,120})\.[A-Za-z0-9_-]{8}\.(js\.map|js|css|svg|png|jpe?g|woff2?)\b/g,
					'$1.<hash>.$2',
				),
			ours,
		);
}

/** Where two answers part, with a little on either side. */
export function parting(a: string, b: string): string {
	let at = 0;
	while (at < a.length && a[at] === b[at]) at += 1;
	const from = Math.max(0, at - 80);
	return `  kit:  ${JSON.stringify(a.slice(from, at + 120))}\n  seam: ${JSON.stringify(b.slice(from, at + 120))}`;
}
