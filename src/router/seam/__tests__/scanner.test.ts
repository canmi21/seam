/* src/router/seam/__tests__/scanner.test.ts */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { scanPages } from '../src/scanner.js'

let tmpDir: string

function mkFile(relPath: string, content = ''): void {
	const abs = path.join(tmpDir, relPath)
	fs.mkdirSync(path.dirname(abs), { recursive: true })
	fs.writeFileSync(abs, content, 'utf-8')
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seam-router-test-'))
})

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('scanPages', () => {
	it('scans root page.tsx', () => {
		mkFile('page.tsx', 'export default function Home() {}')

		const [root] = scanPages({ pagesDir: tmpDir })
		expect(root.segment).toEqual({ type: 'static', value: '' })
		expect(root.pageFile).toBe(path.join(tmpDir, 'page.tsx'))
	})

	it('scans nested directory structure', () => {
		mkFile('dashboard/[username]/page.tsx', 'export default function U() {}')

		const [root] = scanPages({ pagesDir: tmpDir })
		expect(root.children).toHaveLength(1)

		const dashboard = root.children[0]
		expect(dashboard.segment).toEqual({ type: 'static', value: 'dashboard' })

		const username = dashboard.children[0]
		expect(username.segment).toEqual({ type: 'param', name: 'username' })
		expect(username.pageFile).toBe(path.join(tmpDir, 'dashboard', '[username]', 'page.tsx'))
	})

	it('detects group segment', () => {
		mkFile('(marketing)/pricing/page.tsx', 'export default function P() {}')

		const [root] = scanPages({ pagesDir: tmpDir })
		const group = root.children[0]
		expect(group.segment).toEqual({ type: 'group', name: 'marketing' })

		const pricing = group.children[0]
		expect(pricing.segment).toEqual({ type: 'static', value: 'pricing' })
		expect(pricing.pageFile).not.toBeNull()
	})

	it('detects data file alongside page', () => {
		mkFile('page.tsx', 'export default function Home() {}')
		mkFile('page.ts', 'export const loaders = {}')

		const [root] = scanPages({ pagesDir: tmpDir })
		expect(root.pageFile).toBe(path.join(tmpDir, 'page.tsx'))
		expect(root.dataFile).toBe(path.join(tmpDir, 'page.ts'))
	})

	it('detects layout file', () => {
		mkFile('layout.tsx', 'export default function Layout() {}')
		mkFile('page.tsx', 'export default function Home() {}')

		const [root] = scanPages({ pagesDir: tmpDir })
		expect(root.layoutFile).toBe(path.join(tmpDir, 'layout.tsx'))
	})

	it('ignores hidden directories', () => {
		mkFile('.hidden/page.tsx', 'export default function H() {}')
		mkFile('page.tsx', 'export default function Home() {}')

		const [root] = scanPages({ pagesDir: tmpDir })
		expect(root.children).toHaveLength(0)
	})

	it('ignores node_modules', () => {
		mkFile('node_modules/pkg/page.tsx', 'export default function P() {}')
		mkFile('page.tsx', 'export default function Home() {}')

		const [root] = scanPages({ pagesDir: tmpDir })
		expect(root.children).toHaveLength(0)
	})

	it('detects error and loading files', () => {
		mkFile('error.tsx', 'export default function Err() {}')
		mkFile('loading.tsx', 'export default function Load() {}')
		mkFile('not-found.tsx', 'export default function NF() {}')

		const [root] = scanPages({ pagesDir: tmpDir })
		expect(root.errorFile).toBe(path.join(tmpDir, 'error.tsx'))
		expect(root.loadingFile).toBe(path.join(tmpDir, 'loading.tsx'))
		expect(root.notFoundFile).toBe(path.join(tmpDir, 'not-found.tsx'))
	})

	it('throws for non-existent directory', () => {
		expect(() => scanPages({ pagesDir: path.join(tmpDir, 'nonexistent') })).toThrow(
			'does not exist',
		)
	})
})
