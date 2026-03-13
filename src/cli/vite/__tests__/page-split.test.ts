/* src/cli/vite/__tests__/page-split.test.ts */

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { seamPageSplit } from '../src/index.js'
import type { Plugin } from 'vite'

let tmpDir: string | undefined

afterEach(() => {
	delete process.env.SEAM_ROUTES_FILE
	if (tmpDir) {
		rmSync(tmpDir, { recursive: true, force: true })
		tmpDir = undefined
	}
})

function createTmpDir(): string {
	tmpDir = mkdtempSync(join(tmpdir(), 'seam-vite-test-'))
	return tmpDir
}

describe('seamPageSplit', () => {
	it('returns noop when SEAM_ROUTES_FILE unset', () => {
		const plugin = seamPageSplit()
		expect(plugin.name).toBe('seam-page-split')
		expect(plugin.apply).toBe('build')
		expect((plugin as Record<string, unknown>).config).toBeUndefined()
		expect((plugin as Record<string, unknown>).transform).toBeUndefined()
	})

	it('returns noop when routes file not found', () => {
		process.env.SEAM_ROUTES_FILE = '/nonexistent/routes.ts'
		const plugin = seamPageSplit()
		expect(plugin.name).toBe('seam-page-split')
		expect((plugin as Record<string, unknown>).config).toBeUndefined()
	})

	it('returns noop when <2 component references', () => {
		const dir = createTmpDir()
		const routesFile = join(dir, 'routes.ts')
		const homePath = join(dir, 'Home.tsx')
		writeFileSync(homePath, 'export default function Home() { return null }')
		writeFileSync(
			routesFile,
			['import Home from "./Home"', 'export const routes = [{ path: "/", component: Home }]'].join(
				'\n',
			),
		)
		process.env.SEAM_ROUTES_FILE = routesFile
		const plugin = seamPageSplit()
		expect((plugin as Record<string, unknown>).config).toBeUndefined()
	})

	it('active plugin sets base and entries', () => {
		const dir = createTmpDir()
		const routesFile = join(dir, 'routes.ts')
		writeFileSync(join(dir, 'Home.tsx'), 'export default function Home() {}')
		writeFileSync(join(dir, 'About.tsx'), 'export default function About() {}')
		writeFileSync(
			routesFile,
			[
				'import Home from "./Home"',
				'import About from "./About"',
				'export const routes = [',
				'  { path: "/", component: Home },',
				'  { path: "/about", component: About },',
				']',
			].join('\n'),
		)
		process.env.SEAM_ROUTES_FILE = routesFile
		const plugin = seamPageSplit() as Plugin & {
			config: (config: Record<string, unknown>) => Record<string, unknown>
		}
		expect(plugin.config).toBeDefined()
		const result = plugin.config({ build: {} })
		expect(result.base).toBe('/_seam/static/')
		const input = (result.build as Record<string, unknown>).rolldownOptions as Record<
			string,
			unknown
		>
		const entries = (input as { input: Record<string, string> }).input
		expect(entries['page-Home']).toContain('Home.tsx')
		expect(entries['page-About']).toContain('About.tsx')
	})

	it('transform replaces imports with lazy declarations', () => {
		const dir = createTmpDir()
		const routesFile = join(dir, 'routes.ts')
		writeFileSync(join(dir, 'Home.tsx'), 'export default function Home() {}')
		writeFileSync(join(dir, 'About.tsx'), 'export default function About() {}')
		const routesSrc = [
			'import Home from "./Home"',
			'import About from "./About"',
			'export const routes = [',
			'  { path: "/", component: Home },',
			'  { path: "/about", component: About },',
			']',
		].join('\n')
		writeFileSync(routesFile, routesSrc)
		process.env.SEAM_ROUTES_FILE = routesFile
		const plugin = seamPageSplit() as Plugin & {
			transform: (code: string, id: string) => { code: string } | null
		}
		expect(plugin.transform).toBeDefined()
		const result = plugin.transform(routesSrc, routesFile)
		expect(result).not.toBeNull()
		const code = result?.code ?? ''
		expect(code).toContain('__seamLazy')
		expect(code).toContain('() => import("./Home")')
		expect(code).toContain('() => import("./About")')
		expect(code).not.toContain('import Home from')
		expect(code).not.toContain('import About from')
	})
})
