/**
 * One of SvelteKit's own test apps under Vite's dev server, twice -- Kit's own and the fork's --
 * and every page asked of both: the responses have to be the same bytes. The dev server's half of
 * the comparison `compare.ts` makes of the build. See spec/conformance.md, "Stage 2", and
 * spec/roadmap.md, "Vite's dev server: CTR under HMR".
 *
 *   node pkgs/apps/src/compare-dev.ts --app=basics
 *   node pkgs/apps/src/compare-dev.ts --app=basics --kit-root=throw
 *
 * Kit's server is asked first and again after ours, so that a page whose answer Kit itself does not
 * repeat -- a clock, a counter its server keeps -- is unstable rather than different. What two dev
 * servers of one app legitimately differ in is written out before comparing: where each one's Kit
 * and each one's copy of the app sit, which the boot script imports by path, and the version Vite
 * stamps on an optimized dependency, which is a hash of what it optimized.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { configured, routes } from '@seam-js/routes';
import { streamedIn, withoutStreamed } from '@seam-js/stream/fold';
import { bin, pkg, stage, type Staged, vendor } from './stage.ts';
import { ask, parting, type Answer } from './same.ts';
import { answers, specURLs, urlOf } from './urls.ts';

function argument(name: string): string | undefined {
	return process.argv.find((one) => one.startsWith(`--${name}=`))?.slice(name.length + 3);
}

const app = argument('app') ?? 'basics';
const out = resolve(pkg, '.build-apps/compare-dev', app);
const kitRoot = argument('kit-root');
if (kitRoot !== undefined) process.env['SEAM_KIT_ROOT'] = kitRoot;
const seamLog = resolve(out, 'dev.seam.log');
/** The fork, whose source the boot script imports from under ours. */
const fork = resolve(pkg, '../framework');

async function serve(staged: Staged, port: number, log: string): Promise<ChildProcess> {
	if (await answers(port)) throw new Error(`something already listens on ${String(port)}`);
	const child = spawn(
		resolve(bin, 'vite'),
		['dev', '--config', staged.viteConfig, '--port', String(port), '--strictPort'],
		{
			cwd: staged.dir,
			// The dev server's own environment, which `vite dev` sets the rest of.
			env: { ...staged.env, NODE_ENV: undefined, ...staged.previewEnv },
			stdio: ['ignore', openSync(log, 'w'), openSync(log, 'a')],
		},
	);
	for (let i = 0; i < 300; i += 1) {
		if (child.exitCode !== null) break;
		if (await answers(port)) return child;
		await new Promise((done) => setTimeout(done, 100));
	}
	child.kill();
	throw new Error(`the dev server on ${String(port)} did not answer; see ${log}`);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const plain = stage(app, true);
const ours = stage(app, false);

/**
 * A `{@html}` block's anchor as it would be over its content written out: the development runtime
 * writes it as a hash of the content, and the content holds what two servers differ in -- Kit's
 * version, where each one's files sit -- wherever it is a page of the app's own. An anchor is
 * rewritten only where it is the hash of the content up to one of the block ends after it, so an
 * anchor that is wrong stays wrong.
 */
function reanchored(text: string, written: (text: string) => string): string {
	return text.replace(/<!--([0-9a-z]+)-->/g, (whole, hash: string, at: number) => {
		const from = at + whole.length;
		let end = text.indexOf('<!---->', from);
		for (let tries = 0; end !== -1 && tries < 200; tries += 1) {
			const content = text.slice(from, end);
			if (anchorOf(content) === hash) return `<!--${anchorOf(written(content))}-->`;
			end = text.indexOf('<!---->', end + 1);
		}
		return whole;
	});
}

/** Svelte's `hash`, as its development runtime writes a `{@html}` block's anchor. */
function anchorOf(text: string): string {
	const str = text.replace(/\r/g, '');
	let hash = 5381;
	let i = str.length;
	while (i--) hash = ((hash << 5) - hash) ^ str.charCodeAt(i);
	return (hash >>> 0).toString(36);
}

/** What Svelte's development runtime writes into the head about a misplaced element, once. */
const MISPLACED =
	/<script>console\.error\("node_invalid_placement_ssr: (?:[^"\\]|\\.)*"\)<\/script>/g;

/**
 * The bytes with what two servers of one app legitimately differ in written out: where each one's
 * files and Kit sit, which the boot script imports by path, the port, the version Kit names a
 * server by -- the time its config was read, unless the app names one -- and the version Vite
 * stamps on an optimized dependency. And the declared difference of the dev server: the script
 * Svelte writes about a misplaced element, which the compile reports and the program does not
 * write. See spec/conformance.md, "Declared differences".
 */
function normalised(staged: Staged, kit: string): (answer: Answer) => string {
	const stageDir = resolve(pkg, '.build-apps', staged === plain ? 'plain' : 'seam');
	return (answer) => {
		const version = /version: "(\d+)"/.exec(answer.body)?.[1];
		const written = (text: string): string => {
			const named = version === undefined ? text : text.replaceAll(version, '<version>');
			return named
				.replaceAll(staged.dir, '<app>')
				.replaceAll(stageDir, '<stage>')
				.replace(/localhost:\d+/g, 'localhost:<port>')
				.replaceAll(`${kit}/src/`, '<kit>/')
				.replace(/([?&]v=)[0-9a-f]{8}\b/g, '$1<v>');
		};
		const body = written(reanchored(answer.body.replace(MISPLACED, ''), written));
		const location = answer.location.replace(/localhost:\d+/g, 'localhost:<port>');
		return `${String(answer.status)} ${location} ${answer.type}\n${body}`;
	};
}
const kitText = normalised(plain, resolve(vendor));
const seamText = normalised(ours, fork);

const { pages } = await routes(plain.dir);
const base = (await configured(plain.dir)).paths.base;
const based = (url: string): string =>
	base === '' || url === base || url.startsWith(`${base}/`) ? url : `${base}${url}`;
const urls = [
	...new Set([...pages.map((one) => urlOf(one.id)), ...specURLs(plain.dir)].map(based)),
].toSorted();

/** Until the fork's check log ends with `idle`, and has for half a second. */
async function idle(): Promise<void> {
	const at = resolve(ours.dir, '.svelte-kit/seam/dev.log');
	const read = (): string => (existsSync(at) ? readFileSync(at, 'utf8') : '');
	for (let i = 0; i < 1200; i += 1) {
		const before = read();
		if (before.trimEnd().endsWith(' idle')) {
			await new Promise((done) => setTimeout(done, 500));
			if (read() === before) return;
		}
		await new Promise((done) => setTimeout(done, 100));
	}
}

const kitPort = 4794;
const seamPort = 4795;
const servers: ChildProcess[] = [];
const same: string[] = [];
const unstable: string[] = [];
const unsettled: { url: string; kit: string; seam: string }[] = [];
const differ: { url: string; kit: string; seam: string }[] = [];
/**
 * The same once a remote function's id is written out: Kit names a remote module by a hash of its
 * path, and under the dev server a dependency's path carries the `?v=` stamp Vite's optimizer gave
 * it, which two servers give differently. Kit's naming, not this framework's bytes.
 */
const stamped: string[] = [];
const remoteIds = (text: string): string =>
	text.replace(/"[0-9a-z]+\/([A-Za-z_$][\w$]*\/)/g, '"<remote>/$1');
try {
	servers.push(await serve(plain, kitPort, resolve(out, 'dev.kit.log')));
	servers.push(await serve(ours, seamPort, seamLog));
	for (const url of urls) {
		const kitFirst = await ask(kitPort, url, 60_000);
		const seamAnswer = await ask(seamPort, url, 60_000);
		const kitAgain = await ask(kitPort, url, 60_000);
		// What the page streamed after it, taken out of all three: a declared difference.
		const streamed = streamedIn(seamAnswer.body);
		const bare = (answer: Answer): Answer => ({
			...answer,
			body: withoutStreamed(answer.body, streamed),
		});
		const first = kitText(bare(kitFirst));
		const seam = seamText(bare(seamAnswer));
		const again = kitText(bare(kitAgain));
		if (first !== again) {
			if (seam === first || seam === again) unstable.push(url);
			else unsettled.push({ url, kit: first, seam });
		} else if (first === seam) same.push(url);
		else if (remoteIds(first) === remoteIds(seam)) stamped.push(url);
		else differ.push({ url, kit: first, seam });
	}
	// Each route the fork rendered was compiled behind it, and is held to Kit's from its next render on:
	// asked again once the compiles have ended, and the check read off its log once it has.
	await idle();
	for (const url of urls) await ask(seamPort, url, 60_000);
	await idle();
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
	`${JSON.stringify({ same, stamped, unstable, unsettled: unsettled.map((one) => one.url), differ: differ.map((one) => one.url) }, null, '\t')}\n`,
);
/**
 * A page Kit does not repeat whose answers differ from ours in nothing but what changes per request:
 * a number -- a clock, a random, a counter Kit's server was asked twice for -- or a CSP nonce.
 */
const numeric = (text: string): string =>
	text.replace(/nonce="[A-Za-z0-9+/=]+"/g, 'nonce=""').replace(/\d+(?:\.\d+)?/g, '<n>');
const onlyNumbers = unsettled.filter((one) => numeric(one.kit) === numeric(one.seam)).length;
for (const one of differ.slice(0, 20)) console.log(`\n${one.url}\n${parting(one.kit, one.seam)}`);
const log = existsSync(seamLog) ? readFileSync(seamLog, 'utf8').split('\n') : [];
const refused = log.filter((line) => line.startsWith("seam: Kit's root rendered"));
const missed = log.filter((line) => line.startsWith('seam: no program was compiled'));
for (const line of new Set([...refused, ...missed])) console.log(line);
// What the fork's referee said: a render of ours that Kit's root did not write is this compiler's
// fault, and answered with Kit's, so the comparison above would not show it. See spec/build.md.
const kept = resolve(ours.dir, '.svelte-kit/seam/dev.log');
const checkLog = existsSync(kept) ? readFileSync(kept, 'utf8').split('\n') : [];
const disagreed = checkLog.filter((line) => / disagreed \d+ /.test(line));
const held = checkLog.filter((line) => / held /.test(line)).length;
const ssr = checkLog.filter((line) => / ssr /.test(line));
for (const line of [...disagreed, ...ssr]) console.log(line);
console.log(
	`the check: ${String(held)} render(s) held to Kit's, ${String(disagreed.length)} disagreement(s), ` +
		`${String(ssr.length)} route(s) the build renders by SSR`,
);
console.log(
	`\n${String(urls.length)} URLs: ${String(same.length)} the same, ${String(stamped.length)} the same but for ` +
		`a dependency's remote id, ${String(differ.length)} different; ` +
		`${String(unstable.length + unsettled.length)} unstable in Kit's own answers, of which ours matched ` +
		`one of Kit's for ${String(unstable.length)} and neither for ${String(unsettled.length)}, ` +
		`${String(onlyNumbers)} of those differing from Kit's first in numbers and nonces alone. ` +
		`Each difference is in ${out}`,
);
process.exit(differ.length === 0 && disagreed.length === 0 ? 0 : 1);
