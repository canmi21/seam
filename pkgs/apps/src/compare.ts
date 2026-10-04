/**
 * One of SvelteKit's own test apps, built twice -- as Kit alone builds it and with this plugin --
 * and every page asked of both: the responses have to be the same bytes. It is the check the
 * Playwright specs make only where a spec happens to look, made over every page route the app has
 * and every URL its specs name. See spec/conformance.md, "Stage 2".
 *
 *   node pkgs/apps/src/compare.ts --app=basics
 *   node pkgs/apps/src/compare.ts --app=basics --reuse    the last builds, not built again
 *
 * Each URL is asked of two servers of Kit's build and one of ours, once each and in the same order,
 * so that state a server keeps across requests -- a counter several routes share -- stands at the
 * same value in all three. A page whose two answers from Kit already differ -- a clock, a random
 * id -- is unstable rather than different, and is reported apart. What two builds of one app legitimately differ in, the version Kit names
 * each build by and the hashes in the client's file names, is written out before comparing.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bin, pkg, stage, staged, type Staged } from './stage.ts';

function argument(name: string): string | undefined {
	return process.argv.find((one) => one.startsWith(`--${name}=`))?.slice(name.length + 3);
}

const app = argument('app') ?? 'basics';
const out = resolve(pkg, '.build-apps/compare', app);

function build(built: Staged, log: string): void {
	const mode = built.mode === undefined ? [] : ['--mode', built.mode];
	const ran = spawnSync(resolve(bin, 'vite'), ['build', '--config', built.viteConfig, ...mode], {
		cwd: built.dir,
		env: built.env,
		encoding: 'utf8',
		maxBuffer: 1 << 28,
	});
	writeFileSync(log, `${ran.stdout}\n${ran.stderr}`);
	if (ran.status !== 0) throw new Error(`the build in ${built.dir} exited ${String(ran.status)}; see ${log}`);
}

async function preview(built: Staged, port: number): Promise<ChildProcess> {
	// A server already there would answer for this one, and the comparison would be of its app: a
	// run that crashed once left three behind, and every app after it was compared against them.
	if (await answers(port)) throw new Error(`something already listens on ${String(port)}`);
	const child = spawn(
		resolve(bin, 'vite'),
		['preview', '--config', built.viteConfig, '--port', String(port), '--strictPort'],
		{ cwd: built.dir, env: { ...built.env, ...built.previewEnv }, stdio: 'ignore' },
	);
	for (let i = 0; i < 100; i += 1) {
		if (child.exitCode !== null) break;
		if (await answers(port)) return child;
		await new Promise((done) => setTimeout(done, 100));
	}
	child.kill();
	throw new Error(`the preview on ${String(port)} did not answer`);
}

async function answers(port: number): Promise<boolean> {
	try {
		await fetch(`http://localhost:${String(port)}/`, { redirect: 'manual' });
		return true;
	} catch {
		return false;
	}
}

/** A route id with every parameter given a value, which is a URL some request could ask for. */
function urlOf(id: string): string {
	const segments = id
		.split('/')
		.filter((one) => !/^\(.+\)$/.test(one))
		.filter((one) => !/^\[\[.+\]\]$/.test(one))
		.map((one) =>
			one
				.replace(/\[\.\.\.[^\]]+\]/g, 'a/b')
				.replace(/\[x\+([0-9a-f]{2})\]/gi, (_, hex: string) =>
					String.fromCharCode(Number.parseInt(hex, 16)),
				)
				.replace(/\[u\+([0-9a-f]+)\]/gi, (_, hex: string) =>
					String.fromCodePoint(Number.parseInt(hex, 16)),
				)
				.replace(/\[[^\]]+\]/g, 'x'),
		);
	const path = segments.join('/');
	return path.startsWith('/') ? path : `/${path}`;
}

/** Every literal path the app's specs ask for: `goto('/a')`, `request.get('/b')`, `${baseURL}/c`. */
function specURLs(dir: string): string[] {
	const found = new Set<string>();
	const walk = (at: string): void => {
		for (const entry of readdirSync(at, { withFileTypes: true })) {
			const file = join(at, entry.name);
			if (entry.isDirectory()) walk(file);
			else if (/\.(js|ts)$/.test(entry.name)) {
				const text = readFileSync(file, 'utf8');
				for (const one of text.matchAll(/(?:goto|get|post|fetch)\(\s*[`'"](?:\$\{baseURL\})?(\/[^`'"$\s]*)[`'"]/g)) {
					found.add(one[1] as string);
				}
			}
		}
	};
	walk(resolve(dir, 'test'));
	return [...found];
}

interface Answer {
	status: number;
	location: string;
	type: string;
	body: string;
}

async function ask(port: number, url: string): Promise<Answer> {
	try {
		const response = await fetch(`http://localhost:${String(port)}${encodeURI(url)}`, {
			redirect: 'manual',
			headers: { accept: 'text/html' },
			// A page that never answers is reported as that rather than holding the run.
			signal: AbortSignal.timeout(10_000),
		});
		return {
			status: response.status,
			location: response.headers.get('location') ?? '',
			type: response.headers.get('content-type') ?? '',
			body: await response.text(),
		};
	} catch (error) {
		return { status: -1, location: '', type: '', body: String(error) };
	}
}

/** Kit's `outDir` for an app, which `options` moves to `.custom-out-dir`: the one holding a build. */
function outDir(dir: string): string {
	const found = readdirSync(dir).find((one) =>
		existsSync(resolve(dir, one, 'output/server/manifest-full.js')),
	);
	if (found === undefined) throw new Error(`no build under ${dir}`);
	return resolve(dir, found);
}

/** What two builds of one app differ in by construction, written out of an answer. */
function normaliser(dir: string): (answer: Answer) => string {
	// An app with no client at all -- `csr` off everywhere -- has no client build and no version file.
	const file = resolve(outDir(dir), 'output/client/_app/version.json');
	const version = existsSync(file)
		? (JSON.parse(readFileSync(file, 'utf8')) as { version: string }).version
		: null;
	return ({ status, location, type, body }) =>
		[status, location, type, body]
			.join('\n')
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
			);
}

/** Where two answers part, with a little on either side. */
function parting(a: string, b: string): string {
	let at = 0;
	while (at < a.length && a[at] === b[at]) at += 1;
	const from = Math.max(0, at - 80);
	return `  kit:  ${JSON.stringify(a.slice(from, at + 120))}\n  seam: ${JSON.stringify(b.slice(from, at + 120))}`;
}

const reuse = process.argv.includes('--reuse');
let plain = staged(app, true);
let ours = staged(app, false);
if (reuse) {
	for (const file of readdirSync(out)) if (/\.(kit|seam)\.txt$/.test(file)) rmSync(resolve(out, file));
} else {
	rmSync(out, { recursive: true, force: true });
	mkdirSync(out, { recursive: true });
	plain = stage(app, true);
	ours = stage(app, false);
	console.log(`building ${app} twice`);
	build(plain, resolve(out, 'build.plain.log'));
	build(ours, resolve(out, 'build.seam.log'));
}

const { manifest } = (await import(
	pathToFileURL(resolve(outDir(plain.dir), 'output/server/manifest-full.js')).href
)) as {
	manifest: { app_dir: string; app_path: string; routes: { id: string; page: unknown }[] };
};
// Kit's `paths.base`, which `options-2` sets to `/basepath`: the manifest's `app_path` is the base
// and the app directory joined, without the leading slash, and `app_dir` alone where there is none.
const base =
	manifest.app_path === manifest.app_dir
		? ''
		: `/${manifest.app_path.slice(0, -(manifest.app_dir.length + 1))}`;
const based = (url: string): string =>
	base === '' || url === base || url.startsWith(`${base}/`) ? url : `${base}${url}`;
const pages = manifest.routes.filter((one) => one.page !== null).map((one) => urlOf(one.id));
const urls = [...new Set([...pages, ...specURLs(plain.dir)].map(based))].toSorted();

const kitPort = 4791;
const seamPort = 4792;
const againPort = 4793;
const servers: ChildProcess[] = [];
const same: string[] = [];
/** Kit's two answers differ, and ours is one of them: a clock or a counter both servers keep. */
const unstable: string[] = [];
/** Kit's two answers differ, and ours is neither: not settled by this comparison. */
const unsettled: { url: string; kit: string; seam: string }[] = [];
const differ: { url: string; kit: string; seam: string }[] = [];
try {
	servers.push(await preview(plain, kitPort));
	servers.push(await preview(ours, seamPort));
	servers.push(await preview(plain, againPort));
	const kitText = normaliser(plain.dir);
	const seamText = normaliser(ours.dir);
	for (const url of urls) {
		const first = kitText(await ask(kitPort, url));
		const seam = seamText(await ask(seamPort, url));
		const again = kitText(await ask(againPort, url));
		if (first !== again) {
			if (seam === first || seam === again) unstable.push(url);
			else unsettled.push({ url, kit: first, seam });
		} else if (first === seam) same.push(url);
		else differ.push({ url, kit: first, seam });
	}
} finally {
	for (const one of servers) one.kill();
}

differ.forEach((one, i) => {
	writeFileSync(resolve(out, `${String(i)}.kit.txt`), `${one.url}\n${one.kit}`);
	writeFileSync(resolve(out, `${String(i)}.seam.txt`), `${one.url}\n${one.seam}`);
});
unsettled.forEach((one, i) => {
	writeFileSync(resolve(out, `unsettled-${String(i)}.kit.txt`), `${one.url}\n${one.kit}`);
	writeFileSync(resolve(out, `unsettled-${String(i)}.seam.txt`), `${one.url}\n${one.seam}`);
});
writeFileSync(
	resolve(out, 'summary.json'),
	`${JSON.stringify({ same, unstable, unsettled: unsettled.map((one) => one.url), differ: differ.map((one) => one.url) }, null, '\t')}\n`,
);
for (const one of differ.slice(0, 20)) console.log(`\n${one.url}\n${parting(one.kit, one.seam)}`);
console.log(
	`\n${String(urls.length)} URLs: ${String(same.length)} the same, ${String(differ.length)} different; ` +
		`${String(unstable.length + unsettled.length)} unstable in Kit's own answers, of which ours matched ` +
		`one of Kit's for ${String(unstable.length)} and neither for ${String(unsettled.length)}. ` +
		`Each difference is in ${out}`,
);
process.exit(differ.length === 0 ? 0 : 1);
