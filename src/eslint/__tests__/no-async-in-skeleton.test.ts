/* src/eslint/__tests__/no-async-in-skeleton.test.ts */

import { RuleTester } from 'eslint'
import { afterAll, describe, it } from 'vitest'
import rule from '../src/rules/no-async-in-skeleton.js'

RuleTester.afterAll = afterAll
RuleTester.describe = describe
RuleTester.it = it

const tester = new RuleTester({
	languageOptions: {
		ecmaVersion: 'latest',
		sourceType: 'module',
		parserOptions: { ecmaFeatures: { jsx: true } },
	},
})

const PAGE = 'src/pages/home/page.tsx'

tester.run('no-async-in-skeleton', rule, {
	valid: [
		// synchronous component in page file — allowed
		{ code: 'function HomePage() { return <div />; }', filename: PAGE },
		// use() in non-page file — not checked
		{ code: 'const data = use(promise);', filename: 'src/components/home.tsx' },
	],
	invalid: [
		// use() call
		{
			code: 'const data = use(fetchData());',
			filename: PAGE,
			errors: [{ messageId: 'noUse' }],
		},
		// async function component
		{
			code: 'async function HomePage() { return <div />; }',
			filename: PAGE,
			errors: [{ messageId: 'noAsyncComponent' }],
		},
		// async arrow function component
		{
			code: 'const HomePage = async () => <div />;',
			filename: PAGE,
			errors: [{ messageId: 'noAsyncComponent' }],
		},
		// async function expression
		{
			code: 'const HomePage = async function() { return <div />; }',
			filename: PAGE,
			errors: [{ messageId: 'noAsyncComponent' }],
		},
		// async generator function
		{
			code: 'async function* gen() { yield 1; }',
			filename: PAGE,
			errors: [{ messageId: 'noAsyncComponent' }],
		},
		// Suspense boundary
		{
			code: '<Suspense fallback={<p>Loading</p>}><Child /></Suspense>;',
			filename: PAGE,
			errors: [{ messageId: 'noSuspense' }],
		},
	],
})
