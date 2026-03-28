/* src/eslint/__tests__/no-browser-apis-in-skeleton.test.ts */

import { RuleTester } from 'eslint'
import { afterAll, describe, it } from 'vitest'
import rule from '../src/rules/no-browser-apis-in-skeleton.js'

RuleTester.afterAll = afterAll
RuleTester.describe = describe
RuleTester.it = it

const tester = new RuleTester({
	languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
})

const PAGE = 'src/pages/home/page.tsx'

tester.run('no-browser-apis-in-skeleton', rule, {
	valid: [
		// typeof window guard — allowed
		{ code: 'const isSSR = typeof window !== "undefined";', filename: PAGE },
		// browser API in non-page file — not checked
		{ code: "document.getElementById('root');", filename: 'src/components/app.tsx' },
		// globalThis accessing non-browser API — allowed
		{ code: 'const p = globalThis.process;', filename: PAGE },
		// typeof globalThis.window — allowed for guard checks
		{ code: 'const ssr = typeof globalThis.window !== "undefined";', filename: PAGE },
	],
	invalid: [
		// window access
		{
			code: 'const w = window.innerWidth;',
			filename: PAGE,
			errors: [{ messageId: 'forbidden', data: { name: 'window' } }],
		},
		// document access
		{
			code: "document.getElementById('root');",
			filename: PAGE,
			errors: [{ messageId: 'forbidden', data: { name: 'document' } }],
		},
		// localStorage access
		{
			code: "localStorage.getItem('key');",
			filename: PAGE,
			errors: [{ messageId: 'forbidden', data: { name: 'localStorage' } }],
		},
		// sessionStorage access
		{
			code: "sessionStorage.setItem('k', 'v');",
			filename: PAGE,
			errors: [{ messageId: 'forbidden', data: { name: 'sessionStorage' } }],
		},
		// navigator access
		{
			code: 'const ua = navigator.userAgent;',
			filename: PAGE,
			errors: [{ messageId: 'forbidden', data: { name: 'navigator' } }],
		},
		// location access
		{
			code: 'const url = location.href;',
			filename: PAGE,
			errors: [{ messageId: 'forbidden', data: { name: 'location' } }],
		},
		// globalThis.document access
		{
			code: "const el = globalThis.document.getElementById('app');",
			filename: PAGE,
			errors: [{ messageId: 'forbidden', data: { name: 'globalThis.document' } }],
		},
	],
})
