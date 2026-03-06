/* examples/features/query-mutation/src/pages/page.ts */

export const loaders = {
	todos: { procedure: 'listTodos' },
	stats: { procedure: 'getStats' },
}

export const mock = {
	todos: {
		todos: [
			{ id: '1', title: 'Learn SeamJS', done: false },
			{ id: '2', title: 'Build a demo', done: true },
		],
	},
	stats: { totalCount: 2 },
}
