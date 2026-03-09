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

describe('generateRoutesFile: imports and structure', () => {
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

	it('uses posix separators in import paths', () => {
		mkFile('pages/page.tsx', 'export default function Home() {}')

		const tree = scanPages({ pagesDir: path.join(tmpDir, 'pages') })
		const output = generateRoutesFile(tree, {
			outputPath: path.join(tmpDir, 'output', 'routes.ts'),
		})

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

		expect(output).toContain('import Layout_index from')
		expect(output).toContain('import Layout_g_marketing from')
		expect(output).toContain('layout: Layout_index')
		expect(output).toContain('layout: Layout_g_marketing')
	})
})

describe('generateRoutesFile: route groups', () => {
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

		expect(output).toContain('path: "/pricing"')
		expect(output).not.toContain('Layout_index')
	})
})

describe('generateRoutesFile: boundary components', () => {
	it('generates imports and fields for error/loading/not-found', () => {
		mkFile('pages/page.tsx', 'export default function Home() {}')
		mkFile('pages/error.tsx', 'export default function Err() {}')
		mkFile('pages/loading.tsx', 'export default function Loading() {}')
		mkFile('pages/not-found.tsx', 'export default function NF() {}')
		const tree = scanPages({ pagesDir: path.join(tmpDir, 'pages') })
		const output = generateRoutesFile(tree, {
			outputPath: path.join(tmpDir, 'output', 'routes.ts'),
		})
		expect(output).toContain('import Error_index from')
		expect(output).toContain('import Loading_index from')
		expect(output).toContain('import NotFound_index from')
		expect(output).toContain('errorComponent: Error_index')
		expect(output).toContain('pendingComponent: Loading_index')
		expect(output).toContain('notFoundComponent: NotFound_index')
	})

	it('places boundary components on group layout route', () => {
		mkFile('pages/(auth)/layout.tsx', 'export default function L() {}')
		mkFile('pages/(auth)/error.tsx', 'export default function E() {}')
		mkFile('pages/(auth)/login/page.tsx', 'export default function P() {}')
		const tree = scanPages({ pagesDir: path.join(tmpDir, 'pages') })
		const output = generateRoutesFile(tree, {
			outputPath: path.join(tmpDir, 'output', 'routes.ts'),
		})
		expect(output).toContain('import Error_g_auth from')
		expect(output).toContain('errorComponent: Error_g_auth')
		expect(output).toContain('layout: Layout_g_auth')
	})
})

describe('generateRoutesFile: sorting', () => {
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
