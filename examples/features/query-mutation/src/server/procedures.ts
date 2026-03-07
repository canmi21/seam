/* examples/features/query-mutation/src/server/procedures.ts */

import { t } from '@canmi/seam-server'
import type { QueryDef, CommandDef } from '@canmi/seam-server'

interface Todo {
	id: string
	title: string
	done: boolean
}

// In-memory store
const todos: Todo[] = [
	{ id: '1', title: 'Learn SeamJS', done: false },
	{ id: '2', title: 'Build a demo', done: true },
]
let nextId = 3

export const listTodos: QueryDef<Record<string, never>, { todos: Todo[] }> = {
	input: t.object({}),
	output: t.object({
		todos: t.array(
			t.object({
				id: t.string(),
				title: t.string(),
				done: t.boolean(),
			}),
		),
	}),
	cache: { ttl: 30 },
	handler: () => ({ todos: [...todos] }),
}

export const getTodo: QueryDef<{ id: string }, Todo> = {
	input: t.object({ id: t.string() }),
	output: t.object({
		id: t.string(),
		title: t.string(),
		done: t.boolean(),
	}),
	cache: { ttl: 30 },
	handler: ({ input }) => {
		const todo = todos.find((t) => t.id === input.id)
		if (!todo) throw new Error(`Todo ${input.id} not found`)
		return { ...todo }
	},
}

export const addTodo: CommandDef<{ title: string }, Todo> = {
	kind: 'command',
	input: t.object({ title: t.string() }),
	output: t.object({
		id: t.string(),
		title: t.string(),
		done: t.boolean(),
	}),
	invalidates: ['listTodos'],
	handler: ({ input }) => {
		const todo: Todo = { id: String(nextId++), title: input.title, done: false }
		todos.push(todo)
		return { ...todo }
	},
}

export const getStats: QueryDef<Record<string, never>, { totalCount: number }> = {
	input: t.object({}),
	output: t.object({ totalCount: t.int32() }),
	handler: () => ({ totalCount: todos.length }),
}

export const toggleTodo: CommandDef<{ id: string }, { id: string; done: boolean }> = {
	kind: 'command',
	input: t.object({ id: t.string() }),
	output: t.object({ id: t.string(), done: t.boolean() }),
	invalidates: [{ query: 'getTodo', mapping: { id: { from: 'id' } } }, 'listTodos'],
	handler: ({ input }) => {
		const todo = todos.find((t) => t.id === input.id)
		if (!todo) throw new Error(`Todo ${input.id} not found`)
		todo.done = !todo.done
		return { id: todo.id, done: todo.done }
	},
}
