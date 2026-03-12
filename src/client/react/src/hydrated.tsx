/* src/client/react/src/hydrated.tsx */

import { Fragment, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

export interface HydratedProps {
	fallback: ReactNode
	children: ReactNode
}

export function Hydrated({ fallback, children }: HydratedProps): ReactNode {
	const [hydrated, setHydrated] = useState(false)

	useEffect(() => {
		setHydrated(true)
	}, [])

	return <Fragment>{hydrated ? children : fallback}</Fragment>
}
