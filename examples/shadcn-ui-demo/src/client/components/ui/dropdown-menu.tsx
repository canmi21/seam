/* examples/shadcn-ui-demo/src/client/components/ui/dropdown-menu.tsx */

import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import type { ComponentPropsWithoutRef } from 'react'
import { cn } from '../../lib/utils.js'

export const DropdownMenu = DropdownMenuPrimitive.Root
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger

export function DropdownMenuContent({
	className,
	sideOffset = 8,
	...props
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>) {
	return (
		<DropdownMenuPrimitive.Portal>
			<DropdownMenuPrimitive.Content
				sideOffset={sideOffset}
				className={cn(
					'z-50 min-w-56 rounded-3xl border border-white/70 bg-white p-2 shadow-[0_24px_50px_rgba(15,23,42,0.18)] outline-none',
					className,
				)}
				{...props}
			/>
		</DropdownMenuPrimitive.Portal>
	)
}

export function DropdownMenuItem({
	className,
	...props
}: ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item>) {
	return (
		<DropdownMenuPrimitive.Item
			className={cn(
				'flex cursor-default select-none items-center rounded-2xl px-3 py-2 text-sm text-[var(--slate-800)] outline-none hover:bg-[var(--slate-100)] focus:bg-[var(--slate-100)]',
				className,
			)}
			{...props}
		/>
	)
}
