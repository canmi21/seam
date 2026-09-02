import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ComponentIR } from 'injector';
import { createSeamServer, type Route } from './index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string): string => readFileSync(resolve(here, '..', path), 'utf8');

// Parsed once, here, rather than per request. That is the whole difference from v1, which
// re-tokenized the skeleton on every request because the skeleton was a string.
const routes: Record<string, Route> = {
	'/': {
		ir: JSON.parse(read('fixtures/product.ir.json')) as ComponentIR,
		// A placeholder, not a design. This is where server functions will produce a payload
		// the slots can be filled from, and that contract is not settled yet.
		data: JSON.parse(read('fixtures/product.data.json')) as Record<string, unknown>,
	},
};

const port = Number(process.env['PORT'] ?? 5100);
createSeamServer({
	shell: read('app.html'),
	routes,
	staticRoot: resolve(here, '..', 'static'),
}).listen(port, () => console.log(`seam server on http://localhost:${port}`));
