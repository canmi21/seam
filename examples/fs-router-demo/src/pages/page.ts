/* examples/fs-router-demo/src/pages/page.ts */

export const loaders = { home: { procedure: 'getPageData' } }

export const mock = {
	home: { title: 'FS Router Demo', description: 'Filesystem-based routing for SeamJS' },
}

export const head = (data: Record<string, unknown>) => ({
	title: String(data.title),
	meta: [{ name: 'description', content: String(data.description) }],
})
