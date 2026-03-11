/* examples/shadcn-ui-demo/src/client/components/ui/select.tsx */

import * as SelectPrimitive from '@radix-ui/react-select'
import type { ComponentPropsWithoutRef } from 'react'
import { cn } from '../../lib/utils.js'

export const Select = SelectPrimitive.Root
export const SelectValue = SelectPrimitive.Value
export const SelectItemText = SelectPrimitive.ItemText

export function SelectTrigger({
	className,
	children,
	...props
}: ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>) {
	return (
		<SelectPrimitive.Trigger
			className={cn(
				'inline-flex min-w-52 items-center justify-between rounded-full border border-[color:color-mix(in_srgb,var(--slate-900)_12%,white)] bg-white px-4 py-2 text-sm text-[var(--slate-900)] shadow-sm outline-none focus:ring-2 focus:ring-[var(--ring)]',
				className,
			)}
			{...props}
		>
			{children}
			<SelectPrimitive.Icon className="ml-3 text-[var(--slate-500)]">v</SelectPrimitive.Icon>
		</SelectPrimitive.Trigger>
	)
}

export function SelectContent({
	className,
	children,
	position = 'popper',
	...props
}: ComponentPropsWithoutRef<typeof SelectPrimitive.Content>) {
	return (
		<SelectPrimitive.Portal>
			<SelectPrimitive.Content
				position={position}
				className={cn(
					'z-50 overflow-hidden rounded-3xl border border-white/70 bg-white p-2 shadow-[0_24px_50px_rgba(15,23,42,0.18)]',
					className,
				)}
				{...props}
			>
				<SelectPrimitive.Viewport>{children}</SelectPrimitive.Viewport>
			</SelectPrimitive.Content>
		</SelectPrimitive.Portal>
	)
}

export function SelectItem({
	className,
	children,
	...props
}: ComponentPropsWithoutRef<typeof SelectPrimitive.Item>) {
	return (
		<SelectPrimitive.Item
			className={cn(
				'relative flex cursor-default select-none items-center rounded-2xl px-3 py-2 text-sm text-[var(--slate-800)] outline-none hover:bg-[var(--slate-100)] focus:bg-[var(--slate-100)]',
				className,
			)}
			{...props}
		>
			<SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
		</SelectPrimitive.Item>
	)
}
