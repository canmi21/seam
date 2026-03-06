/* examples/features/query-mutation/src/pages/page.tsx */

import { useState, useEffect } from 'react'
import { useSeamData } from '@canmi/seam-react'
import { seamRpc } from '@canmi/seam-client'
import { SeamQueryProvider, useSeamQuery, useSeamMutation } from '@canmi/seam-query-react'
import { seamProcedureConfig } from '../generated/client.js'

interface Todo {
	id: string
	title: string
	done: boolean
}

interface PageData extends Record<string, unknown> {
	todos: { todos: Todo[] }
	stats: { totalCount: number }
}

function TodoList() {
	const { data, isLoading } = useSeamQuery('listTodos', {})
	const toggleMutation = useSeamMutation('toggleTodo')
	const todosData = data as { todos: Todo[] } | undefined

	if (isLoading) return <p>Loading...</p>

	return (
		<ul>
			{todosData?.todos.map((todo) => (
				<li key={todo.id}>
					<label>
						<input
							type="checkbox"
							checked={todo.done}
							onChange={() => toggleMutation.mutate({ id: todo.id })}
						/>
						<span style={{ textDecoration: todo.done ? 'line-through' : 'none' }}>
							{todo.title}
						</span>
					</label>
				</li>
			))}
		</ul>
	)
}

function AddTodoForm() {
	const [title, setTitle] = useState('')
	const addMutation = useSeamMutation('addTodo')

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault()
		if (!title.trim()) return
		addMutation.mutate({ title: title.trim() })
		setTitle('')
	}

	return (
		<form onSubmit={handleSubmit}>
			<input
				type="text"
				value={title}
				onChange={(e) => setTitle(e.target.value)}
				placeholder="New todo..."
			/>
			<button type="submit">Add</button>
		</form>
	)
}

/* Static list rendered during skeleton (SSR), before QueryClient exists */
function StaticTodoList({ todos }: { todos: Todo[] }) {
	return (
		<ul>
			{todos.map((todo) => (
				<li key={todo.id}>
					<label>
						<input type="checkbox" checked={todo.done} readOnly />
						<span style={{ textDecoration: todo.done ? 'line-through' : 'none' }}>
							{todo.title}
						</span>
					</label>
				</li>
			))}
		</ul>
	)
}

export default function TodoPage() {
	const data = useSeamData<PageData>()
	const [mounted, setMounted] = useState(false)
	useEffect(() => setMounted(true), [])

	/* SeamQueryProvider uses @tanstack/react-query which calls Date.now() on init.
     Skeleton rendering forbids browser APIs, so we defer to client only. */
	if (!mounted) {
		return (
			<div>
				<h1>Query & Mutation Demo</h1>
				<p data-testid="stats">Total: {data.stats.totalCount}</p>
				<StaticTodoList todos={data.todos.todos} />
				<a href="/about">About</a>
			</div>
		)
	}

	return (
		<div>
			<h1>Query & Mutation Demo</h1>
			<p data-testid="stats">Total: {data.stats.totalCount}</p>
			<a href="/about">About</a>
			<SeamQueryProvider
				rpcFn={seamRpc}
				config={seamProcedureConfig}
				initialData={data}
				loaderDefs={{ todos: { procedure: 'listTodos' } }}
			>
				<AddTodoForm />
				<TodoList />
			</SeamQueryProvider>
		</div>
	)
}
