/* src/router/seam/__tests__/generator.test.ts */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateRoutesFile } from '../src/generator.js'
import { scanPages } from '../src/scanner.js'

let tmpDir: string

function mkFile(relPath: string, content = ''): void {
	const abs = path.join(tmpDir, relPath)
	fs.mkdirSync(path.dirname(abs), { recursive: true })
	fs.writeFileSync(abs, content, 'utf-8')
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seam-gen-test-'))
})

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('generateRoutesFile', () => {
	it('generates correct imports and defineSeamRoutes', () => {
		mkFile('pages/page.tsx', 'export default function Home() {}')
		mkFile('pages/about/page.tsx', 'export default function About() {}')

		const tree = scanPages({ pagesDir: path.join(tmpDir, 'pages') })
		const output = generateRoutesFile(tree, {
			outputPath: path.join(tmpDir, 'output', 'routes.ts'),
		})

		expect(output).toContain('defineSeamRoutes')
		expect(output).toContain('import Page_index from')
		expect(output).toContain('import Page_about from')
		expect(output).toContain('path: "/"')
		expect(output).toContain('path: "/about"')
	})

	it('wraps group with layout in layout wrapper', () => {
		mkFile('pages/(auth)/layout.tsx', 'export default function AuthLayout() {}')
		mkFile('pages/(auth)/login/page.tsx', 'export default function Login() {}')

		const tree = scanPages({ pagesDir: path.join(tmpDir, 'pages') })
		const output = generateRoutesFile(tree, {
			outputPath: path.join(tmpDir, 'output', 'routes.ts'),
		})

		expect(output).toContain('layout: Layout_g_auth')
		expect(output).toContain('path: "/login"')
	})

	it('merges group without layout into parent', () => {
		mkFile('pages/(public)/pricing/page.tsx', 'export default function Pricing() {}')

		const tree = scanPages({ pagesDir: path.join(tmpDir, 'pages') })
		const output = generateRoutesFile(tree, {
			outputPath: path.join(tmpDir, 'output', 'routes.ts'),
		})

		// No layout wrapper — pricing appears directly
		expect(output).toContain('path: "/pricing"')
		expect(output).not.toContain('Layout_index')
	})

	it('uses posix separators in import paths', () => {
		mkFile('pages/page.tsx', 'export default function Home() {}')

		const tree = scanPages({ pagesDir: path.join(tmpDir, 'pages') })
		const output = generateRoutesFile(tree, {
			outputPath: path.join(tmpDir, 'output', 'routes.ts'),
		})

		// No backslashes in import paths
		const importLines = output.split('\n').filter((l) => l.startsWith('import '))
		for (const line of importLines) {
			expect(line).not.toContain('\\')
		}
	})

	it('imports data exports from page.ts', () => {
		mkFile('pages/page.tsx', 'export default function Home() {}')
		mkFile('pages/page.ts', 'export const loaders = {}\nexport const mock = {}')

		const tree = scanPages({ pagesDir: path.join(tmpDir, 'pages') })
		const output = generateRoutesFile(tree, {
			outputPath: path.join(tmpDir, 'output', 'routes.ts'),
		})

		expect(output).toContain('loaders as Page_index_loaders')
		expect(output).toContain('mock as Page_index_mock')
		expect(output).toContain('loaders: Page_index_loaders')
		expect(output).toContain('mock: Page_index_mock')
	})

	it('generates unique import names for root layout and group layout', () => {
		mkFile('pages/page.tsx', 'export default function Home() {}')
		mkFile('pages/layout.tsx', 'export default function RootLayout() {}')
		mkFile('pages/(marketing)/layout.tsx', 'export default function MktLayout() {}')
		mkFile('pages/(marketing)/pricing/page.tsx', 'export default function Pricing() {}')

		const tree = scanPages({ pagesDir: path.join(tmpDir, 'pages') })
		const output = generateRoutesFile(tree, {
			outputPath: path.join(tmpDir, 'output', 'routes.ts'),
		})

		// Root layout and group layout must have distinct import names
		expect(output).toContain('import Layout_index from')
		expect(output).toContain('import Layout_g_marketing from')
		expect(output).toContain('layout: Layout_index')
		expect(output).toContain('layout: Layout_g_marketing')
	})

	it('sorts children: static before param before catch-all', () => {
		mkFile('pages/about/page.tsx', 'export default function About() {}')
		mkFile('pages/[id]/page.tsx', 'export default function Id() {}')
		mkFile('pages/[...slug]/page.tsx', 'export default function Slug() {}')

		const tree = scanPages({ pagesDir: path.join(tmpDir, 'pages') })
		const output = generateRoutesFile(tree, {
			outputPath: path.join(tmpDir, 'output', 'routes.ts'),
		})

		const aboutIdx = output.indexOf('path: "/about"')
		const idIdx = output.indexOf('path: "/:id"')
		const slugIdx = output.indexOf('path: "/*slug"')

		expect(aboutIdx).toBeLessThan(idIdx)
		expect(idIdx).toBeLessThan(slugIdx)
	})
})
