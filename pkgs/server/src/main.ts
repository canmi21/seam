import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ComponentIR } from 'injector';
import { compile as compileDerivations, type Derivation } from 'derive';
import { createServer, type Route } from './index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const read = (path: string): string => readFileSync(resolve(here, '..', path), 'utf8');
const readRoot = (path: string): string => readFileSync(resolve(here, '../../..', path), 'utf8');

// Parsed once, here, rather than per request. That is the whole difference from v1, which
// re-tokenized the skeleton on every request because the skeleton was a string.
const routes: Record<string, Route> = {
	'/': {
		...(() => {
			const compiled = JSON.parse(readRoot('conformance/cases/product.ir.json')) as {
				ir: ComponentIR;
				derivations: Derivation[];
			};
			return { ir: compiled.ir, derive: compileDerivations(compiled.derivations) };
		})(),
		// A placeholder, not a design. This is where server functions will produce a payload
		// the slots can be filled from, and that contract is not settled yet.
		data: JSON.parse(read('fixtures/product.data.json')) as Record<string, unknown>,
	},
};

const port = Number(process.env['PORT'] ?? 5100);
createServer({
	shell: read('app.html'),
	routes,
	staticRoot: resolve(here, '..', 'static'),
}).listen(port, () => console.log(`serving on http://localhost:${port}`));
