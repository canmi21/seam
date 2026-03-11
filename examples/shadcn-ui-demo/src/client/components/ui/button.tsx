/* examples/shadcn-ui-demo/src/client/components/ui/button.tsx */

import type { ButtonHTMLAttributes } from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils.js'

const buttonVariants = cva(
	'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:pointer-events-none disabled:opacity-50',
	{
		variants: {
			variant: {
				primary:
					'border-[var(--cobalt-700)] bg-[var(--cobalt-600)] px-4 py-2 text-white hover:bg-[var(--cobalt-700)]',
				secondary:
					'border-[color:color-mix(in_srgb,var(--slate-900)_12%,white)] bg-white/80 px-4 py-2 text-[var(--slate-900)] hover:bg-white',
				ghost:
					'border-transparent bg-transparent px-3 py-2 text-[var(--slate-700)] hover:bg-white/70',
			},
		},
		defaultVariants: {
			variant: 'primary',
		},
	},
)

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
	VariantProps<typeof buttonVariants> & {
		asChild?: boolean
	}

export function Button({ className, variant, asChild = false, ...props }: ButtonProps) {
	const Comp = asChild ? Slot : 'button'
	return <Comp className={cn(buttonVariants({ variant }), className)} {...props} />
}
