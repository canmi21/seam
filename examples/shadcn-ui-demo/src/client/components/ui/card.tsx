/* examples/shadcn-ui-demo/src/client/components/ui/card.tsx */

import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/utils.js'

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
	return (
		<div
			className={cn(
				'rounded-[1.75rem] border border-white/60 bg-white/80 p-6 shadow-[0_24px_60px_rgba(27,33,58,0.12)] backdrop-blur',
				className,
			)}
			{...props}
		/>
	)
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
	return <div className={cn('flex flex-col gap-2', className)} {...props} />
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
	return (
		<h2
			className={cn('text-2xl font-semibold tracking-[-0.03em] text-[var(--slate-950)]', className)}
			{...props}
		/>
	)
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
	return (
		<p
			className={cn('max-w-2xl text-sm leading-6 text-[var(--slate-600)]', className)}
			{...props}
		/>
	)
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
	return <div className={cn('mt-6', className)} {...props} />
}
