/* examples/shadcn-ui-demo/src/client/components/ui/dialog.tsx */

import * as DialogPrimitive from '@radix-ui/react-dialog'
import type { ComponentPropsWithoutRef } from 'react'
import { cn } from '../../lib/utils.js'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

function DialogPortal({ ...props }: ComponentPropsWithoutRef<typeof DialogPrimitive.Portal>) {
	return <DialogPrimitive.Portal {...props} />
}

export function DialogOverlay({
	className,
	...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>) {
	return (
		<DialogPrimitive.Overlay
			className={cn('fixed inset-0 bg-[rgba(15,23,42,0.45)] backdrop-blur-sm', className)}
			{...props}
		/>
	)
}

export function DialogContent({
	className,
	children,
	...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Content>) {
	return (
		<DialogPortal>
			<DialogOverlay />
			<DialogPrimitive.Content
				className={cn(
					'fixed left-1/2 top-1/2 w-[min(92vw,34rem)] -translate-x-1/2 -translate-y-1/2 rounded-[1.5rem] border border-white/70 bg-white p-6 shadow-[0_32px_90px_rgba(15,23,42,0.24)] focus:outline-none',
					className,
				)}
				{...props}
			>
				{children}
			</DialogPrimitive.Content>
		</DialogPortal>
	)
}

export function DialogHeader({ className, ...props }: ComponentPropsWithoutRef<'div'>) {
	return <div className={cn('flex flex-col gap-2', className)} {...props} />
}

export function DialogTitle({
	className,
	...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) {
	return (
		<DialogPrimitive.Title
			className={cn('text-lg font-semibold text-[var(--slate-950)]', className)}
			{...props}
		/>
	)
}

export function DialogDescription({
	className,
	...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Description>) {
	return (
		<DialogPrimitive.Description
			className={cn('text-sm leading-6 text-[var(--slate-600)]', className)}
			{...props}
		/>
	)
}
