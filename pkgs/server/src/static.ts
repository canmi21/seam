import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type { ServerResponse } from 'node:http';

const TYPES: Record<string, string> = {
	'.css': 'text/css; charset=utf-8',
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.map': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
};

export async function serveStatic(
	root: string,
	pathname: string,
	response: ServerResponse,
): Promise<boolean> {
	const base = resolve(root);
	// decodeURIComponent first, or `%2e%2e%2f` walks out of the directory while the string
	// being checked still looks like it stays inside.
	const target = resolve(join(base, decodeURIComponent(pathname)));
	if (target !== base && !target.startsWith(base + sep)) return false;

	const found = await stat(target).catch(() => undefined);
	if (found === undefined || !found.isFile()) return false;

	const extension = target.slice(target.lastIndexOf('.'));
	response.writeHead(200, {
		'content-type': TYPES[extension] ?? 'application/octet-stream',
		'content-length': found.size,
	});
	createReadStream(target).pipe(response);
	return true;
}
