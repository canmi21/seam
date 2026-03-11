/* examples/shadcn-ui-demo/src/client/components/ui/badge.tsx */

import type { HTMLAttributes } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils.js'

const badgeVariants = cva(
	'inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]',
	{
		variants: {
			variant: {
				accent: 'bg-[var(--amber-200)] text-[var(--slate-900)]',
				info: 'bg-[var(--cobalt-100)] text-[var(--cobalt-900)]',
				subtle: 'bg-white/70 text-[var(--slate-700)]',
			},
		},
		defaultVariants: {
			variant: 'subtle',
		},
	},
)

type BadgeProps = HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>

export function Badge({ className, variant, ...props }: BadgeProps) {
	return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}
