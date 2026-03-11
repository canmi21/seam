/* examples/shadcn-ui-demo/src/client/pages/showcase-page.tsx */

import { useEffect, useState, type ReactNode } from 'react'
import { useSeamData } from '@canmi/seam-react'
import { Badge } from '../components/ui/badge.js'
import { Button } from '../components/ui/button.js'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card.js'
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '../components/ui/dialog.js'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from '../components/ui/dropdown-menu.js'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '../components/ui/select.js'

type IntroData = {
	title: string
	subtitle: string
}

function SectionChrome({
	order,
	title,
	description,
	children,
}: {
	order: string
	title: string
	description: string
	children: ReactNode
}) {
	return (
		<Card>
			<CardHeader>
				<div className="flex items-center gap-3">
					<Badge variant="info">{order}</Badge>
					<CardTitle>{title}</CardTitle>
				</div>
				<CardDescription>{description}</CardDescription>
			</CardHeader>
			<CardContent>{children}</CardContent>
		</Card>
	)
}

export function ShowcasePage() {
	const intro = useSeamData<IntroData>('intro')
	const [count, setCount] = useState(0)
	const [hydrated, setHydrated] = useState(false)

	useEffect(() => {
		setHydrated(true)
	}, [])

	return (
		<div
			className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.92),_rgba(226,232,240,0.82)_45%,_rgba(191,219,254,0.62)_100%)] px-5 py-10 text-[var(--slate-900)]"
			data-hydrated={hydrated ? 'yes' : 'no'}
		>
			<div className="mx-auto flex max-w-6xl flex-col gap-8">
				<header className="grid gap-6 rounded-[2rem] border border-white/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.88),rgba(219,234,254,0.72))] p-8 shadow-[0_28px_80px_rgba(41,59,101,0.14)] backdrop-blur">
					<div className="flex flex-wrap items-center gap-3">
						<Badge variant="accent">CTR</Badge>
						<Badge>Tailwind CSS v4</Badge>
						<Badge>shadcn/ui</Badge>
					</div>
					<div className="grid gap-3">
						<h1 className="max-w-4xl text-5xl font-semibold tracking-[-0.06em]">{intro.title}</h1>
						<p className="max-w-3xl text-lg leading-8 text-[var(--slate-700)]">{intro.subtitle}</p>
					</div>
					<div className="flex flex-wrap items-center gap-4">
						<Button onClick={() => setCount((value) => value + 1)} data-testid="counter-button">
							Hydration counter
						</Button>
						<Badge variant="subtle" data-testid="counter-value">
							count {count}
						</Badge>
						<Badge variant={hydrated ? 'info' : 'subtle'} data-testid="hydration-state">
							{hydrated ? 'hydrated' : 'ssr'}
						</Badge>
					</div>
				</header>

				<SectionChrome
					order="01"
					title="Display primitives in the skeleton"
					description="Button, Badge, and Card render complete stable DOM during CTR extraction. What you see in the HTML is already useful before any client code runs."
				>
					<div className="grid gap-6 lg:grid-cols-[1.4fr,1fr]">
						<div className="flex flex-wrap items-center gap-3">
							<Button>Primary action</Button>
							<Button variant="secondary">Secondary action</Button>
							<Button variant="ghost" asChild>
								<a href="#portal-closed">Jump to portal section</a>
							</Button>
						</div>
						<div className="grid gap-3">
							<Badge variant="accent">stable html</Badge>
							<Badge variant="info">no portal</Badge>
							<Badge>no browser globals</Badge>
						</div>
					</div>
				</SectionChrome>

				<SectionChrome
					order="02"
					title="Closed portal components on the first render path"
					description="Dialog, DropdownMenu, and Select can now stay on the SSR path. During server render they produce stable triggers; the portal content is attached only after hydration and user interaction."
				>
					<div id="portal-closed" className="flex flex-wrap items-start gap-4">
						<Dialog>
							<DialogTrigger asChild>
								<Button variant="secondary" data-testid="closed-dialog-trigger">
									Open closed dialog
								</Button>
							</DialogTrigger>
							<DialogContent>
								<DialogHeader>
									<DialogTitle>Closed dialog content</DialogTitle>
									<DialogDescription>
										This portal is absent from SSR HTML and appears only when opened after
										hydration.
									</DialogDescription>
								</DialogHeader>
								<div className="mt-4 flex justify-end">
									<DialogClose asChild>
										<Button variant="secondary" data-testid="closed-dialog-close">
											Close
										</Button>
									</DialogClose>
								</div>
							</DialogContent>
						</Dialog>

						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button variant="secondary" data-testid="closed-menu-trigger">
									Open closed menu
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent>
								<DropdownMenuItem>Profile</DropdownMenuItem>
								<DropdownMenuItem>Billing</DropdownMenuItem>
								<DropdownMenuItem>Sign out</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>

						<Select defaultValue="server">
							<SelectTrigger data-testid="select-trigger">
								<SelectValue placeholder="Choose a render mode" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="server">Server-safe trigger</SelectItem>
								<SelectItem value="client">Hydrated portal</SelectItem>
								<SelectItem value="mixed">Mixed rendering</SelectItem>
							</SelectContent>
						</Select>
					</div>
				</SectionChrome>

				<SectionChrome
					order="03"
					title="Default-open portal components"
					description="These components are intentionally default-open on the first render path. Their SSR output still degrades to triggers only, then the overlays appear immediately after hydration."
				>
					<div className="flex flex-wrap items-start gap-4">
						<Dialog defaultOpen>
							<DialogTrigger asChild>
								<Button data-testid="default-open-dialog-trigger">Default-open dialog</Button>
							</DialogTrigger>
							<DialogContent data-testid="default-open-dialog-content">
								<DialogHeader>
									<DialogTitle>Default-open dialog body</DialogTitle>
									<DialogDescription>
										If you view raw SSR HTML, this text is missing. After hydration, it mounts
										through Radix Portal.
									</DialogDescription>
								</DialogHeader>
								<div className="mt-5 flex justify-end">
									<DialogClose asChild>
										<Button variant="secondary" data-testid="default-open-dialog-close">
											Close default-open dialog
										</Button>
									</DialogClose>
								</div>
							</DialogContent>
						</Dialog>

						<DropdownMenu defaultOpen>
							<DropdownMenuTrigger asChild>
								<Button variant="secondary" data-testid="default-open-menu-trigger">
									Default-open menu
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent data-testid="default-open-menu-content">
								<DropdownMenuItem>Default-open menu item</DropdownMenuItem>
								<DropdownMenuItem>Hydrated immediately</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</SectionChrome>
			</div>
		</div>
	)
}
