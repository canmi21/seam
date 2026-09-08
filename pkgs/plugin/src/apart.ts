/**
 * The compile, in a process of its own, which is the whole point of the file.
 *
 * A compile of press holds about a gigabyte that is still referenced when it ends and grows two
 * and a half more that V8 will not hand back, and the build it belongs to then bundles from that
 * floor. Nothing it makes is read in memory -- the artifacts are files -- so the cheapest way to
 * give the memory back is to stop being the same process. This is what `seam()` spawns; what
 * crosses the boundary is one JSON argument, and what comes back is an exit code and whatever the
 * compile printed. See `compile.ts` and spec/build.md.
 */
import { compileRoutes, type Compiling } from './compile.ts';

const [given] = process.argv.slice(2);
if (given === undefined) {
	console.error('usage: node apart.ts <json>');
	process.exit(2);
}

try {
	await compileRoutes(JSON.parse(given) as Compiling);
	// Said rather than left to happen. A Vite server keeps handles its `close()` does not release
	// -- the runner's transport, the watcher it was told not to start -- so the process would sit
	// here having finished, and the build that spawned it would wait on nothing. Every artifact was
	// written synchronously before this line, so there is nothing left to flush.
	process.exit(0);
} catch (error) {
	// The message rather than the stack: a refusal is a list of components and why each was
	// refused, and a stack of this file's frames says nothing about any of them.
	console.error((error as Error).message);
	process.exit(1);
}
