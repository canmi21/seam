/* examples/standalone/server-bun/src/procedures/greet.ts */

import { t } from '@canmi/seam-server'
import type { QueryDef } from '@canmi/seam-server'

export const greet: QueryDef<{ name: string }, { message: string }> = {
	input: t.object({ name: t.string() }),
	output: t.object({ message: t.string() }),
	handler: ({ input }) => {
		return { message: `Hello, ${input.name}!` }
	},
}
