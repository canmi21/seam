/* tests/e2e/fixture/src/server/procedures.ts */

import { t } from '@canmi/seam-server'
import type { QueryDef } from '@canmi/seam-server'

export const getHomeData: QueryDef = {
	input: t.object({}),
	output: t.object({
		title: t.string(),
		message: t.string(),
	}),
	handler: () => ({
		title: 'E2E Fixture',
		message: 'Hydration test page.',
	}),
}

export const getReact19Data: QueryDef = {
	input: t.object({}),
	output: t.object({
		heading: t.string(),
		description: t.string(),
	}),
	handler: () => ({
		heading: 'React 19 Features',
		description: 'Demonstrating useId, Suspense, useState, useRef, useMemo, and metadata hoisting.',
	}),
}

export const getFormPageData: QueryDef = {
	input: t.object({}),
	output: t.object({ heading: t.string() }),
	handler: () => ({ heading: 'Contact Form' }),
}

export const submitContact: QueryDef = {
	input: t.object({
		name: t.string(),
		email: t.string(),
	}),
	output: t.object({ message: t.string() }),
	handler: (ctx) => {
		const { name, email } = (ctx as { input: { name: string; email: string } }).input
		return { message: `Thanks, ${name}! We will contact you at ${email}.` }
	},
}

export const getErrorPageData: QueryDef = {
	input: t.object({}),
	output: t.object({ heading: t.string() }),
	handler: () => ({ heading: 'Error Boundary Test' }),
}

export const getAsyncPageData: QueryDef = {
	input: t.object({}),
	output: t.object({ heading: t.string() }),
	handler: () => ({ heading: 'Async Loading Test' }),
}

export const getRenderedContent: QueryDef = {
	input: t.object({}),
	output: t.object({
		title: t.string(),
		bodyHtml: t.html(),
	}),
	handler: () => ({
		title: 'Test Post',
		bodyHtml: '<h2>Hello from <em>HTML slot</em></h2><p>This was <strong>not</strong> escaped.</p>',
	}),
}

export const getAsyncItems: QueryDef = {
	input: t.object({}),
	output: t.object({
		items: t.array(t.object({ id: t.int32(), label: t.string() })),
	}),
	handler: () => ({
		items: [
			{ id: 1, label: 'Alpha' },
			{ id: 2, label: 'Beta' },
			{ id: 3, label: 'Gamma' },
		],
	}),
}
