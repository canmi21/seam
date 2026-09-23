import { structures, joined, merged } from 'compiler';
import { carry } from 'carry';
import { compile } from 'derive';
import { inject } from 'injector';
import { lower } from 'lowering';
for (const dir of process.argv.slice(2)) {
	try {
		const runs = await structures({ path: '/', component: 'main.svelte' }, dir);
		const lowered = lower(runs.map((o) => [o.id, JSON.stringify(o.skeleton)] as const));
		const first = runs[0]!;
		const c = joined(first.id, runs.map((o, at) => ({ fixed: o.fixed, decided: o.decided, compiled: lowered[at] as never })), first.skeleton.defaults);
		const carried = await carry(first.file, merged(runs.map((o) => o.names)));
		const out = await inject(c.ir as never, compile(c.derivations, carried)({}));
		console.log(dir.split('/').pop(), 'OK', JSON.stringify(out.body).slice(0, 200));
	} catch (e) {
		let x: unknown = e; const chain: string[] = [];
		while (x) { chain.push(String((x as Error).message).slice(0, 200)); x = (x as { cause?: unknown }).cause; }
		console.log(dir.split('/').pop(), '->', chain.join('\n    <- '));
	}
}
