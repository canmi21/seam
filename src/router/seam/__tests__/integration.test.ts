/* src/router/seam/__tests__/integration.test.ts */

import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateRoutesFile } from '../src/generator.js'
import { scanPages } from '../src/scanner.js'
import { validateRouteTree } from '../src/validator.js'

/**
 * End-to-end integration tests for the full scan → validate → generate pipeline.
 * These exercise realistic page directory layouts rather than individual functions.
 */

let tmpDir: string
let pagesDir: string

function mkFile(relPath: string, content = ''): void {
	const abs = path.join(pagesDir, relPath)
	fs.mkdirSync(path.dirname(abs), { recursive: true })
	fs.writeFileSync(abs, content, 'utf-8')
}

function outputPath(): string {
	return path.join(tmpDir, '.seam', 'generated', 'routes.ts')
}

/** Run the full pipeline and return the generated output. */
function runPipeline(): string {
	const tree = scanPages({ pagesDir })
	const errors = validateRouteTree(tree)
	if (errors.length > 0) {
		throw new Error(errors.map((e) => e.message).join('\n'))
	}
	return generateRoutesFile(tree, { outputPath: outputPath() })
}

/** Run scan + validate and return errors (without generating). */
function runValidation() {
	const tree = scanPages({ pagesDir })
	return validateRouteTree(tree)
}

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seam-integration-'))
	pagesDir = path.join(tmpDir, 'pages')
	fs.mkdirSync(pagesDir, { recursive: true })
})

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true })
})

// ─── Correct Path Tests ───────────────────────────────────────────────────

describe('correct path: basic routes', () => {
	it('root page only', () => {
		mkFile('page.tsx')

		const output = runPipeline()
		expect(output).toContain('path: "/"')
		expect(output).toContain('component: Page_index')
	})

	it('root page with layout', () => {
		mkFile('page.tsx')
		mkFile('layout.tsx')

		const output = runPipeline()
		expect(output).toContain('component: Page_index')
		expect(output).toContain('layout: Layout_index')
	})

	it('nested static routes', () => {
		mkFile('page.tsx')
		mkFile('about/page.tsx')
		mkFile('blog/page.tsx')

		const output = runPipeline()
		expect(output).toContain('path: "/about"')
		expect(output).toContain('path: "/blog"')
		expect(output).toContain('component: Page_about')
		expect(output).toContain('component: Page_blog')
	})

	it('deeply nested routes', () => {
		mkFile('dashboard/settings/profile/page.tsx')

		const output = runPipeline()
		expect(output).toContain('path: "/dashboard"')
		expect(output).toContain('path: "/settings"')
		expect(output).toContain('path: "/profile"')
	})
})

describe('correct path: dynamic segments', () => {
	it('single param [id]', () => {
		mkFile('users/[id]/page.tsx')

		const output = runPipeline()
		expect(output).toContain('path: "/:id"')
		expect(output).toContain('component: Page_users__id')
	})

	it('optional param [[id]]', () => {
		mkFile('users/[[id]]/page.tsx')

		const output = runPipeline()
		expect(output).toContain('path: "/:id?"')
	})

	it('catch-all [...slug]', () => {
		mkFile('blog/[...slug]/page.tsx')

		const output = runPipeline()
		expect(output).toContain('path: "/*slug"')
	})

	it('optional catch-all [[...path]]', () => {
		mkFile('docs/[[...path]]/page.tsx')

		const output = runPipeline()
		expect(output).toContain('path: "/*path?"')
	})

	it('multiple param levels', () => {
		mkFile('orgs/[orgId]/repos/[repoId]/page.tsx')

		const output = runPipeline()
		expect(output).toContain('path: "/:orgId"')
		expect(output).toContain('path: "/:repoId"')
	})
})

describe('correct path: route groups', () => {
	it('group with layout creates wrapper', () => {
		mkFile('(auth)/layout.tsx')
		mkFile('(auth)/login/page.tsx')
		mkFile('(auth)/register/page.tsx')

		const output = runPipeline()
		expect(output).toContain('layout: Layout_g_auth')
		expect(output).toContain('path: "/login"')
		expect(output).toContain('path: "/register"')
		// Group name not in URL path
		expect(output).not.toContain('path: "/(auth)"')
	})

	it('group without layout merges children up', () => {
		mkFile('(public)/pricing/page.tsx')
		mkFile('(public)/features/page.tsx')

		const output = runPipeline()
		expect(output).toContain('path: "/pricing"')
		expect(output).toContain('path: "/features"')
		// No Layout_g_public since no layout file
		expect(output).not.toContain('Layout_g_public')
	})

	it('multiple groups with unique import names', () => {
		mkFile('layout.tsx')
		mkFile('(marketing)/layout.tsx')
		mkFile('(marketing)/pricing/page.tsx')
		mkFile('(admin)/layout.tsx')
		mkFile('(admin)/dashboard/page.tsx')

		const output = runPipeline()
		expect(output).toContain('Layout_index')
		expect(output).toContain('Layout_g_marketing')
		expect(output).toContain('Layout_g_admin')
		// All three are distinct imports
		const importLines = output.split('\n').filter((l) => l.startsWith('import '))
		const layoutImports = importLines.filter((l) => l.includes('Layout_'))
		expect(new Set(layoutImports).size).toBe(layoutImports.length)
	})
})

describe('correct path: data files', () => {
	it('page.ts with loaders export', () => {
		mkFile('page.tsx')
		mkFile('page.ts', 'export const loaders = {}')

		const output = runPipeline()
		expect(output).toContain('loaders as Page_index_loaders')
		expect(output).toContain('loaders: Page_index_loaders')
	})

	it('multiple data exports', () => {
		mkFile('page.tsx')
		mkFile('page.ts', 'export const loaders = {}\nexport const mock = {}')

		const output = runPipeline()
		expect(output).toContain('loaders as Page_index_loaders')
		expect(output).toContain('mock as Page_index_mock')
	})

	it('layout data file', () => {
		mkFile('layout.tsx')
		mkFile('layout.ts', 'export const loaders = {}')
		mkFile('page.tsx')

		const output = runPipeline()
		expect(output).toContain('loaders as Layout_index_loaders')
	})

	it('nested route with data', () => {
		mkFile('dashboard/[username]/page.tsx')
		mkFile('dashboard/[username]/page.ts', 'export const loaders = {}')

		const output = runPipeline()
		expect(output).toContain('loaders as Page_dashboard__username_loaders')
	})
})

describe('correct path: sorting', () => {
	it('static routes before dynamic', () => {
		mkFile('[id]/page.tsx')
		mkFile('about/page.tsx')

		const output = runPipeline()
		const aboutIdx = output.indexOf('path: "/about"')
		const idIdx = output.indexOf('path: "/:id"')
		expect(aboutIdx).toBeLessThan(idIdx)
	})

	it('param before catch-all (in separate parents to avoid conflict)', () => {
		// Param and catch-all at the same level triggers catch-all-conflict.
		// Test sorting via separate parent dirs that each contain one kind.
		mkFile('a/[id]/page.tsx')
		mkFile('b/[...slug]/page.tsx')

		const output = runPipeline()
		// Both parent dirs are static, sorted alphabetically by name
		const aIdx = output.indexOf('path: "/a"')
		const bIdx = output.indexOf('path: "/b"')
		expect(aIdx).toBeLessThan(bIdx)
		expect(output).toContain('path: "/:id"')
		expect(output).toContain('path: "/*slug"')
	})

	it('static before optional-param before optional-catch-all', () => {
		// Only segment types that don't conflict with each other
		mkFile('about/page.tsx')
		mkFile('[[opt]]/page.tsx')
		mkFile('[[...oall]]/page.tsx')

		const output = runPipeline()
		const positions = [
			output.indexOf('path: "/about"'),
			output.indexOf('path: "/:opt?"'),
			output.indexOf('path: "/*oall?"'),
		]
		for (let i = 1; i < positions.length; i++) {
			expect(positions[i - 1]).toBeLessThan(positions[i])
		}
	})
})

describe('correct path: full realistic layout', () => {
	it('complete app structure with groups, params, catch-all, data files', () => {
		mkFile('page.tsx')
		mkFile('layout.tsx')
		mkFile('page.ts', 'export const loaders = {}')
		mkFile('about/page.tsx')
		mkFile('docs/[[...path]]/page.tsx')
		mkFile('blog/[...slug]/page.tsx')
		mkFile('(marketing)/layout.tsx')
		mkFile('(marketing)/features/page.tsx')
		mkFile('(marketing)/pricing/page.tsx')
		mkFile('dashboard/[username]/page.tsx')
		mkFile('dashboard/[username]/page.ts', 'export const loaders = {}')
		mkFile('dashboard/[username]/settings/page.tsx')

		const output = runPipeline()

		// Default imports are all unique (named imports use aliasing so skip those)
		const defaultImportLines = output.split('\n').filter((l) => /^import \w/.test(l))
		const importNames = defaultImportLines.map((l) => l.match(/^import (\w+)/)?.[1]).filter(Boolean)
		expect(new Set(importNames).size).toBe(importNames.length)

		// Structure checks
		expect(output).toContain('layout: Layout_index')
		expect(output).toContain('layout: Layout_g_marketing')
		expect(output).toContain('loaders: Page_index_loaders')
		expect(output).toContain('loaders: Page_dashboard__username_loaders')
		expect(output).toContain('path: "/*path?"')
		expect(output).toContain('path: "/*slug"')
		expect(output).toContain('path: "/:username"')

		// Output is valid-looking TS (starts with comment, has defineSeamRoutes)
		expect(output).toMatch(/^\/\* \.seam\/generated\/routes\.ts/)
		expect(output).toContain('export default defineSeamRoutes([')
	})
})

// ─── Error Path Tests (Category 1: Validation Errors) ─────────────────────

describe('error path: duplicate routes', () => {
	it('two groups resolving to same URL path', () => {
		mkFile('(a)/about/page.tsx')
		mkFile('(b)/about/page.tsx')

		const errors = runValidation()
		expect(errors.length).toBeGreaterThan(0)
		expect(errors[0].type).toBe('duplicate-path')
		expect(errors[0].message).toContain('/about')
	})

	it('group route clashing with non-group route', () => {
		mkFile('about/page.tsx')
		mkFile('(public)/about/page.tsx')

		const errors = runValidation()
		expect(errors.length).toBeGreaterThan(0)
		expect(errors[0].type).toBe('duplicate-path')
	})
})

describe('error path: ambiguous dynamic segments', () => {
	it('two params with different names at same level', () => {
		mkFile('users/[id]/page.tsx')
		mkFile('users/[slug]/page.tsx')

		const errors = runValidation()
		expect(errors.length).toBeGreaterThan(0)
		expect(errors[0].type).toBe('ambiguous-dynamic')
	})
})

describe('error path: catch-all conflicts', () => {
	it('catch-all alongside param at same level', () => {
		mkFile('blog/[...slug]/page.tsx')
		mkFile('blog/[id]/page.tsx')

		const errors = runValidation()
		expect(errors.length).toBeGreaterThan(0)
		expect(errors[0].type).toBe('catch-all-conflict')
	})
})

// ─── Error Path Tests (Category 2: Invalid Input) ─────────────────────────

describe('error path: invalid segment names', () => {
	it('malformed brackets throw during scan', () => {
		mkFile('[/page.tsx')

		expect(() => scanPages({ pagesDir })).toThrow()
	})

	it('empty brackets throw during scan', () => {
		mkFile('[]/page.tsx')

		expect(() => scanPages({ pagesDir })).toThrow()
	})

	it('nested brackets like [[[name]]] throw', () => {
		mkFile('[[[name]]]/page.tsx')

		expect(() => scanPages({ pagesDir })).toThrow()
	})
})

describe('error path: empty pages dir', () => {
	it('empty dir produces root node with no pages and no errors', () => {
		const tree = scanPages({ pagesDir })
		const errors = validateRouteTree(tree)
		// Scanner always creates a root node for the pages dir
		expect(tree.length).toBe(1)
		expect(tree[0].pageFile).toBeNull()
		expect(tree[0].children).toEqual([])
		expect(errors).toEqual([])
	})
})

describe('error path: pipeline rejects invalid trees', () => {
	it('runPipeline throws on validation errors', () => {
		mkFile('(a)/about/page.tsx')
		mkFile('(b)/about/page.tsx')

		expect(() => runPipeline()).toThrow('Duplicate')
	})
})
