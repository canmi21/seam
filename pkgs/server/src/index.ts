import {
	createServer as createHttpServer,
	type IncomingMessage,
	type ServerResponse,
} from 'node:http';
import { inject, type ComponentIR } from 'injector';
import { normalized, rawPaths } from 'normalize';
import { wrap } from './document.ts';
import { serveStatic } from './static.ts';

export interface Route {
	ir: ComponentIR;
	/**
	 * What this document has to load, as the compiler wrote it. A finished string rather than a
	 * list of files, so that nothing here has to spell a script tag. See spec/build.md.
	 */
	head: string;
	/// Runs once per request, over data, before anything is injected.
	derive: (payload: Record<string, unknown>) => Record<string, unknown>;
	data: Record<string, unknown>;
}

export interface Options {
	shell: string;
	routes: Record<string, Route>;
	staticRoot: string;
	/**
	 * Put what `{@html}` writes through a parser before either the bytes or the wire see it.
	 *
	 * On by default, and there is one thing it buys: written as it arrived, a raw value does not
	 * stay where it was put, and an unclosed tag takes the anchor that ends the block with it.
	 * It is not sanitisation. See spec/refusals.md.
	 */
	normalize?: boolean;
}

async function handle(
	options: Options,
	request: IncomingMessage,
	response: ServerResponse,
): Promise<void> {
	const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;

	const route = options.routes[pathname];
	if (route !== undefined) {
		// The paths are the IR's, so what is handed over is the shape the IR resolves against
		// rather than the load stage's output, and what comes back is unwrapped again.
		const clean =
			options.normalize === false
				? route.data
				: (normalized({ data: route.data }, rawPaths(route.ir))['data'] as Record<string, unknown>);

		// Two things, one level apart. The scope injection walks holds the data and the derived
		// fields beside it; the wire carries the data alone. Both come from the same object, which
		// is what makes the bytes and the payload agree about a raw value.
		const scope = route.derive(clean);
		const { body, head } = inject(route.ir, scope);
		const html = wrap(options.shell, body, clean, head + route.head);
		response.writeHead(200, {
			'content-type': 'text/html; charset=utf-8',
			'content-length': Buffer.byteLength(html),
		});
		response.end(html);
		return;
	}

	if (await serveStatic(options.staticRoot, pathname, response)) return;

	response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
	response.end('not found\n');
}

export function createServer(options: Options) {
	return createHttpServer((request, response) => {
		handle(options, request, response).catch((error: unknown) => {
			console.error(error);
			if (!response.headersSent) response.writeHead(500);
			response.end();
		});
	});
}
