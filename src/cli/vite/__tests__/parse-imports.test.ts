/* src/cli/vite/__tests__/parse-imports.test.ts */

import { describe, it, expect } from 'vitest'
import { parseComponentImports } from '../src/index.js'

describe('parseComponentImports', () => {
	it('parses default import', () => {
		const result = parseComponentImports('import Home from "./Home"')
		expect(result).toEqual(new Map([['Home', './Home']]))
	})

	it('parses named import', () => {
		const result = parseComponentImports('import { Dashboard } from "./pages"')
		expect(result).toEqual(new Map([['Dashboard', './pages']]))
	})

	it('parses renamed import', () => {
		const result = parseComponentImports('import { Dash as Dashboard } from "./D"')
		expect(result).toEqual(new Map([['Dashboard', './D']]))
	})

	it('parses mixed default + named import', () => {
		const result = parseComponentImports('import App, { Sidebar } from "./app"')
		expect(result).toEqual(
			new Map([
				['App', './app'],
				['Sidebar', './app'],
			]),
		)
	})

	it('returns empty map when no imports', () => {
		const result = parseComponentImports('const x = 1;')
		expect(result).toEqual(new Map())
	})
})
