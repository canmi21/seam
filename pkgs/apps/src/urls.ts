/**
 * What a comparison asks a server for, and whether one is there to ask: the URLs of an app's pages
 * and of its specs, for the build's comparison and the dev server's alike. See spec/conformance.md,
 * "Stage 2".
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export async function answers(port: number): Promise<boolean> {
	try {
		await fetch(`http://localhost:${String(port)}/`, { redirect: 'manual' });
		return true;
	} catch {
		return false;
	}
}

/** A route id with every parameter given a value, which is a URL some request could ask for. */
export function urlOf(id: string): string {
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
export function specURLs(dir: string): string[] {
	const found = new Set<string>();
	const walk = (at: string): void => {
		for (const entry of readdirSync(at, { withFileTypes: true })) {
			const file = join(at, entry.name);
			if (entry.isDirectory()) walk(file);
			else if (/\.(js|ts)$/.test(entry.name)) {
				const text = readFileSync(file, 'utf8');
				for (const one of text.matchAll(
					/(?:goto|get|post|fetch)\(\s*[`'"](?:\$\{baseURL\})?(\/[^`'"$\s]*)[`'"]/g,
				)) {
					found.add(one[1] as string);
				}
			}
		}
	};
	walk(resolve(dir, 'test'));
	return [...found];
}
