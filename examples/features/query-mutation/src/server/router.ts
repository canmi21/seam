/* examples/features/query-mutation/src/server/router.ts */

import { createRouter } from '@canmi/seam-server'
import type { RouterOptions } from '@canmi/seam-server'
import { listTodos, getTodo, getStats, addTodo, toggleTodo } from './procedures.js'

export const procedures = { listTodos, getTodo, getStats, addTodo, toggleTodo }

export function buildRouter(opts?: RouterOptions) {
	return createRouter(procedures, opts)
}

export const router = buildRouter()
