import {
	createServer as createHttpServer,
	type IncomingMessage,
	type ServerResponse,
} from 'node:http';
import { inject, type ComponentIR } from 'injector';
import { wrap } from './document.ts';
import { serveStatic } from './static.ts';

export interface Route {
	ir: ComponentIR;
	/// Runs once per request, over data, before anything is injected.
	derive: (payload: Record<string, unknown>) => Record<string, unknown>;
	data: Record<string, unknown>;
}

export interface Options {
	shell: string;
	routes: Record<string, Route>;
	staticRoot: string;
}

async function handle(
	options: Options,
	request: IncomingMessage,
	response: ServerResponse,
): Promise<void> {
	const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;

	const route = options.routes[pathname];
	if (route !== undefined) {
		// Two things, one level apart. The scope injection walks holds the data and the derived
		// fields beside it; the wire carries the data alone.
		const scope = route.derive(route.data);
		const { body, head } = inject(route.ir, scope);
		const html = wrap(options.shell, body, route.data, head);
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
