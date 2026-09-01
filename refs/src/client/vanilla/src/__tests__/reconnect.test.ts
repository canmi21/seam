/* src/client/vanilla/src/__tests__/reconnect.test.ts */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ReconnectController, defaultReconnectConfig } from '../reconnect.js'
import type { ConnectionState } from '../reconnect.js'

function setupFakeTimers() {
	beforeEach(() => {
		vi.useFakeTimers()
	})
	afterEach(() => {
		vi.useRealTimers()
	})
}

describe('ReconnectController', () => {
	setupFakeTimers()

	it('starts in connecting state', () => {
		const rc = new ReconnectController()
		expect(rc.state).toBe('connecting')
		rc.dispose()
	})

	it('transitions to connected on success', () => {
		const rc = new ReconnectController()
		rc.onSuccess()
		expect(rc.state).toBe('connected')
		rc.dispose()
	})

	it('schedules reconnect with exponential backoff', () => {
		const connect = vi.fn()
		const rc = new ReconnectController({ initialDelay: 100, maxDelay: 1000 })
		rc.onSuccess()

		rc.onClose(connect)
		expect(rc.state).toBe('reconnecting')
		expect(connect).not.toHaveBeenCalled()

		// First retry after ~100ms (+ jitter)
		vi.advanceTimersByTime(120)
		expect(connect).toHaveBeenCalledTimes(1)
		expect(rc.retries).toBe(1)

		// Simulate another failure
		rc.onClose(connect)
		// Second retry after ~200ms
		vi.advanceTimersByTime(230)
		expect(connect).toHaveBeenCalledTimes(2)
		expect(rc.retries).toBe(2)

		rc.dispose()
	})

	it('caps delay at maxDelay', () => {
		const connect = vi.fn()
		const rc = new ReconnectController({ initialDelay: 100, maxDelay: 300 })
		rc.onSuccess()

		// Retry 0: 100ms, Retry 1: 200ms, Retry 2: 300ms (capped), Retry 3: 300ms (capped)
		for (let i = 0; i < 4; i++) {
			rc.onClose(connect)
			vi.advanceTimersByTime(350)
		}
		expect(connect).toHaveBeenCalledTimes(4)
		rc.dispose()
	})

	it('stops after maxRetries', () => {
		const connect = vi.fn()
		const rc = new ReconnectController({ initialDelay: 50, maxRetries: 2 })
		rc.onSuccess()

		rc.onClose(connect)
		vi.advanceTimersByTime(100)
		expect(connect).toHaveBeenCalledTimes(1)

		rc.onClose(connect)
		vi.advanceTimersByTime(200)
		expect(connect).toHaveBeenCalledTimes(2)

		// Third close: maxRetries reached
		rc.onClose(connect)
		expect(rc.state).toBe('closed')
		vi.advanceTimersByTime(1000)
		expect(connect).toHaveBeenCalledTimes(2)
		rc.dispose()
	})
})

describe('ReconnectController — recovery and cleanup', () => {
	setupFakeTimers()

	it('resets retry count on success', () => {
		const connect = vi.fn()
		const rc = new ReconnectController({ initialDelay: 50 })
		rc.onSuccess()

		rc.onClose(connect)
		vi.advanceTimersByTime(100)
		expect(rc.retries).toBe(1)

		rc.onSuccess()
		expect(rc.retries).toBe(0)
		rc.dispose()
	})

	it('does not reconnect when disabled', () => {
		const connect = vi.fn()
		const rc = new ReconnectController({ enabled: false })
		rc.onSuccess()
		rc.onClose(connect)
		expect(rc.state).toBe('closed')
		vi.advanceTimersByTime(60_000)
		expect(connect).not.toHaveBeenCalled()
		rc.dispose()
	})

	it('notifies state change listeners', () => {
		const states: ConnectionState[] = []
		const rc = new ReconnectController({ initialDelay: 50 })
		rc.onStateChange((s) => states.push(s))

		rc.onSuccess() // connecting -> connected
		rc.onClose(() => {}) // connected -> reconnecting
		vi.advanceTimersByTime(100)
		rc.onSuccess() // reconnecting -> connected

		expect(states).toEqual(['connected', 'reconnecting', 'connected'])
		rc.dispose()
	})

	it('cleans up on dispose', () => {
		const connect = vi.fn()
		const rc = new ReconnectController({ initialDelay: 50 })
		rc.onSuccess()
		rc.onClose(connect)
		rc.dispose()

		expect(rc.state).toBe('closed')
		vi.advanceTimersByTime(1000)
		expect(connect).not.toHaveBeenCalled()
	})

	it('uses default config values', () => {
		expect(defaultReconnectConfig.enabled).toBe(true)
		expect(defaultReconnectConfig.maxRetries).toBe(Infinity)
		expect(defaultReconnectConfig.initialDelay).toBe(1_000)
		expect(defaultReconnectConfig.maxDelay).toBe(30_000)
		expect(defaultReconnectConfig.staleTimeout).toBe(35_000)
	})
})
