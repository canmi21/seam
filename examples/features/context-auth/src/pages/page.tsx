/* examples/features/context-auth/src/pages/page.tsx */

import { useState } from 'react'
import { useSeamData } from '@canmi/seam-react'

interface PageData extends Record<string, unknown> {
	info: { message: string }
}

/* Context extract: "header:authorization" → JSON.parse(headerValue).
   Send raw JSON as the Authorization header value. */
function makeToken(userId: string, role: string): string {
	return JSON.stringify({ userId, role })
}

export default function AuthPage() {
	const data = useSeamData<PageData>()
	const [token, setToken] = useState<string | null>(null)
	const [secret, setSecret] = useState<string | null>(null)
	const [profileResult, setProfileResult] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)

	const isLoggedIn = token !== null

	function login() {
		setToken(makeToken('user-42', 'admin'))
		setSecret(null)
		setProfileResult(null)
		setError(null)
	}

	function logout() {
		setToken(null)
		setSecret(null)
		setProfileResult(null)
		setError(null)
	}

	async function fetchSecret() {
		setError(null)
		try {
			const headers: Record<string, string> = {}
			if (token) headers.Authorization = token
			const res = await fetch(`${window.location.origin}/_seam/procedure/getSecretData`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...headers },
				body: '{}',
			})
			const body = await res.json()
			if (body.ok) {
				setSecret((body as { data: { message: string } }).data.message)
			} else {
				setError((body as { error: { message: string } }).error.message)
			}
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Request failed')
		}
	}

	async function updateProfile() {
		setError(null)
		try {
			const headers: Record<string, string> = {}
			if (token) headers.Authorization = token
			const res = await fetch(`${window.location.origin}/_seam/procedure/updateProfile`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...headers },
				body: JSON.stringify({ name: 'New Name' }),
			})
			const body = await res.json()
			if (body.ok) {
				const d = (body as { data: { ok: boolean; updatedBy: string } }).data
				setProfileResult(`Updated by ${d.updatedBy}`)
			} else {
				setError((body as { error: { message: string } }).error.message)
			}
		} catch (e) {
			setError(e instanceof Error ? e.message : 'Request failed')
		}
	}

	return (
		<div>
			<h1>Context Auth Demo</h1>
			<p>{data.info.message}</p>

			<h2>Authentication</h2>
			{!isLoggedIn ? (
				<button type="button" onClick={login}>
					Login (fake token)
				</button>
			) : (
				<div>
					<p>Logged in as user-42 (admin)</p>
					<button type="button" onClick={logout}>
						Logout
					</button>
				</div>
			)}

			<h2>Protected Endpoints</h2>
			<button type="button" onClick={fetchSecret}>
				Fetch Secret
			</button>
			<button type="button" onClick={updateProfile}>
				Update Profile
			</button>

			{secret && <p>Secret: {secret}</p>}
			{profileResult && <p>Profile: {profileResult}</p>}
			{error && <p style={{ color: 'red' }}>Error: {error}</p>}
		</div>
	)
}
