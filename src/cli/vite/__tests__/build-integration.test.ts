/* src/cli/vite/__tests__/build-integration.test.ts */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
	mkdtempSync,
	mkdirSync,
	writeFileSync,
	readFileSync,
	readdirSync,
	realpathSync,
	rmSync,
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { build } from 'vite'
import { seam } from '../src/index.js'

const ENV_KEYS = [
	'SEAM_DIST_DIR',
	'SEAM_OBFUSCATE',
	'SEAM_SOURCEMAP',
	'SEAM_ENTRY',
	'SEAM_TYPE_HINT',
	'SEAM_HASH_LENGTH',
	'SEAM_RPC_MAP_PATH',
	'SEAM_ROUTES_FILE',
	'SEAM_DEV_OUT_DIR',
]

const savedEnv: Record<string, string | undefined> = {}
let tmpDir: string | undefined

function createTmpDir(): string {
	// realpathSync resolves macOS /var -> /private/var symlink to match Vite's resolved paths
	tmpDir = realpathSync(mkdtempSync(join(tmpdir(), 'seam-vite-build-')))
	return tmpDir
}

function collectJsFiles(dir: string): string[] {
	const result: string[] = []
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const full = join(dir, entry.name)
		if (entry.isDirectory()) result.push(...collectJsFiles(full))
		else if (entry.name.endsWith('.js')) result.push(full)
	}
	return result
}

function readOutputJs(outDir: string): string {
	return collectJsFiles(outDir)
		.map((f) => readFileSync(f, 'utf-8'))
		.join('\n')
}

beforeEach(() => {
	for (const k of ENV_KEYS) {
		savedEnv[k] = process.env[k]
		delete process.env[k]
	}
})

afterEach(() => {
	for (const k of ENV_KEYS) {
		if (savedEnv[k] === undefined) delete process.env[k]
		else process.env[k] = savedEnv[k]
	}
	if (tmpDir) {
		rmSync(tmpDir, { recursive: true, force: true })
		tmpDir = undefined
	}
})

describe('vite build integration', { timeout: 30_000 }, () => {
	it('builds successfully and generates manifest with resolved virtual modules', async () => {
		const dir = createTmpDir()
		const seamGen = join(dir, '.seam', 'generated')
		mkdirSync(seamGen, { recursive: true })
		writeFileSync(join(seamGen, 'client.ts'), 'export const DATA_ID = "__data"')

		const srcDir = join(dir, 'src')
		mkdirSync(srcDir, { recursive: true })
		writeFileSync(
			join(srcDir, 'main.ts'),
			[
				'import { DATA_ID } from "virtual:seam/client"',
				'import routes from "virtual:seam/routes"',
				'console.log(DATA_ID, routes)',
			].join('\n'),
		)

		process.env.SEAM_ENTRY = join(srcDir, 'main.ts')
		const plugins = seam()

		await build({
			root: dir,
			plugins,
			logLevel: 'silent',
		})

		const outDir = join(dir, '.seam', 'dist')
		const manifestPath = join(outDir, '.vite', 'manifest.json')
		expect(readFileSync(manifestPath, 'utf-8')).toBeTruthy()

		const output = readOutputJs(outDir)
		expect(output).toContain('__data')
		expect(output).not.toContain('virtual:seam/')
	})

	it('replaces procedure names with hashes', async () => {
		const dir = createTmpDir()
		const seamGen = join(dir, '.seam', 'generated')
		mkdirSync(seamGen, { recursive: true })
		writeFileSync(join(seamGen, 'client.ts'), 'export const DATA_ID = "__data"')

		const srcDir = join(dir, 'src')
		mkdirSync(srcDir, { recursive: true })
		writeFileSync(join(srcDir, 'main.ts'), 'const proc = "user.list"\nconsole.log(proc)')

		const mapPath = join(dir, 'rpc-map.json')
		writeFileSync(mapPath, JSON.stringify({ procedures: { 'user.list': 'h_abc123' }, batch: '_b' }))

		process.env.SEAM_RPC_MAP_PATH = mapPath
		process.env.SEAM_ENTRY = join(srcDir, 'main.ts')
		const plugins = seam()

		await build({
			root: dir,
			plugins,
			logLevel: 'silent',
		})

		const output = readOutputJs(join(dir, '.seam', 'dist'))
		expect(output).toContain('h_abc123')
		expect(output).not.toContain('user.list')
	})

	it('creates separate entry files for page components', async () => {
		const dir = createTmpDir()
		const seamGen = join(dir, '.seam', 'generated')
		mkdirSync(seamGen, { recursive: true })
		writeFileSync(join(seamGen, 'client.ts'), 'export const DATA_ID = "__data"')

		const srcDir = join(dir, 'src')
		mkdirSync(srcDir, { recursive: true })
		writeFileSync(
			join(srcDir, 'Home.ts'),
			'export function Home() { return document.createElement("div") }',
		)
		writeFileSync(
			join(srcDir, 'About.ts'),
			'export function About() { return document.createElement("span") }',
		)

		const routesFile = join(srcDir, 'routes.ts')
		writeFileSync(
			routesFile,
			[
				'import { Home } from "./Home"',
				'import { About } from "./About"',
				'export default [',
				'  { path: "/", component: Home },',
				'  { path: "/about", component: About },',
				']',
			].join('\n'),
		)

		process.env.SEAM_ROUTES_FILE = routesFile
		process.env.SEAM_ENTRY = routesFile
		const plugins = seam()

		const result = await build({
			root: dir,
			plugins,
			logLevel: 'silent',
			build: {
				write: false,
				rolldownOptions: { treeshake: false },
			},
		})

		const bundle = Array.isArray(result) ? result[0] : result
		const chunks = bundle.output.filter((o) => o.type === 'chunk')
		const allCode = chunks.map((c) => c.code).join('\n')

		// Verify page entries exist as separate chunks
		const pageChunks = chunks.filter((c) => c.isEntry && c.name?.startsWith('page-'))
		expect(pageChunks.length).toBeGreaterThanOrEqual(2)

		// Routes chunk should contain dynamic import and __seamLazy marker
		expect(allCode).toContain('import(')
		expect(allCode).toContain('__seamLazy')
	})
})
