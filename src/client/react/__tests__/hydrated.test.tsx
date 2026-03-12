/* src/client/react/__tests__/hydrated.test.tsx */
/* oxlint-disable @typescript-eslint/no-non-null-assertion */

// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot, type Root } from 'react-dom/client'
import { Hydrated } from '../src/index.js'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root | null

beforeEach(() => {
	container = document.createElement('div')
	document.body.appendChild(container)
	root = null
})

afterEach(async () => {
	if (root) {
		await act(async () => {
			root!.unmount()
		})
	}
	container.remove()
})

function App(props: { fallback: React.ReactNode; children: React.ReactNode }) {
	return createElement(Hydrated, props, props.children)
}

describe('Hydrated', () => {
	it('renders fallback during SSR', () => {
		const html = renderToString(
			createElement(App, {
				fallback: createElement('p', { id: 'fallback' }, 'Static shell'),
				children: createElement('p', { id: 'interactive' }, 'Interactive view'),
			}),
		)

		expect(html).toContain('Static shell')
		expect(html).not.toContain('Interactive view')
	})

	it('keeps fallback through hydration and swaps to children after effects run', async () => {
		const element = createElement(App, {
			fallback: createElement('p', { id: 'fallback' }, 'Static shell'),
			children: createElement('p', { id: 'interactive' }, 'Interactive view'),
		})

		container.innerHTML = renderToString(element)
		expect(container.querySelector('#fallback')!.textContent).toBe('Static shell')
		expect(container.querySelector('#interactive')).toBeNull()

		root = hydrateRoot(container, element)

		expect(container.querySelector('#fallback')!.textContent).toBe('Static shell')
		expect(container.querySelector('#interactive')).toBeNull()

		await act(async () => {
			await Promise.resolve()
		})

		expect(container.querySelector('#fallback')).toBeNull()
		expect(container.querySelector('#interactive')!.textContent).toBe('Interactive view')
	})

	it('allows an explicit empty fallback', async () => {
		const element = createElement(App, {
			fallback: null,
			children: createElement('p', { id: 'interactive' }, 'Interactive view'),
		})

		expect(renderToString(element)).toBe('')

		container.innerHTML = ''
		root = hydrateRoot(container, element)

		expect(container.textContent).toBe('')

		await act(async () => {
			await Promise.resolve()
		})

		expect(container.querySelector('#interactive')!.textContent).toBe('Interactive view')
	})
})
