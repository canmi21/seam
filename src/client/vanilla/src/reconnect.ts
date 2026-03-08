/* src/client/vanilla/src/reconnect.ts */

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'offline' | 'closed'

export interface ReconnectConfig {
	enabled: boolean
	maxRetries: number
	initialDelay: number
	maxDelay: number
	staleTimeout: number
}

export const defaultReconnectConfig: ReconnectConfig = {
	enabled: true,
	maxRetries: Infinity,
	initialDelay: 1_000,
	maxDelay: 30_000,
	staleTimeout: 35_000,
}

export class ReconnectController {
	private config: ReconnectConfig
	private retryCount = 0
	private timer: ReturnType<typeof setTimeout> | null = null
	private stateListeners: Array<(state: ConnectionState) => void> = []
	private _state: ConnectionState = 'connecting'
	private onlineHandler: (() => void) | null = null
	private offlineHandler: (() => void) | null = null
	private connectFn: (() => void) | null = null

	constructor(config: Partial<ReconnectConfig> = {}) {
		this.config = { ...defaultReconnectConfig, ...config }

		if (typeof globalThis.addEventListener === 'function') {
			this.onlineHandler = () => this.onOnline()
			this.offlineHandler = () => this.onOffline()
			globalThis.addEventListener('online', this.onlineHandler)
			globalThis.addEventListener('offline', this.offlineHandler)
		}
	}

	get state(): ConnectionState {
		return this._state
	}

	get retries(): number {
		return this.retryCount
	}

	onStateChange(cb: (state: ConnectionState) => void): void {
		this.stateListeners.push(cb)
	}

	private setState(state: ConnectionState): void {
		if (this._state === state) return
		this._state = state
		for (const cb of this.stateListeners) cb(state)
	}

	onSuccess(): void {
		this.retryCount = 0
		this.setState('connected')
	}

	onClose(connectFn: () => void): void {
		if (this._state === 'closed') return
		this.connectFn = connectFn
		if (!this.config.enabled) {
			this.setState('closed')
			return
		}
		if (this.retryCount >= this.config.maxRetries) {
			this.setState('closed')
			return
		}
		this.scheduleReconnect(connectFn)
	}

	private scheduleReconnect(connectFn: () => void): void {
		if (this._state === 'offline') return
		this.setState('reconnecting')
		const delay = Math.min(
			this.config.initialDelay * Math.pow(2, this.retryCount),
			this.config.maxDelay,
		)
		// Add 10% jitter
		const jitter = delay * 0.1 * Math.random()
		this.timer = setTimeout(() => {
			this.timer = null
			this.retryCount++
			connectFn()
		}, delay + jitter)
	}

	private onOnline(): void {
		if (this._state !== 'offline') return
		if (this.timer) {
			clearTimeout(this.timer)
			this.timer = null
		}
		// Immediate reconnect on network recovery
		if (this.connectFn) {
			this.retryCount = 0
			this.setState('reconnecting')
			this.connectFn()
		}
	}

	private onOffline(): void {
		if (this._state === 'closed') return
		if (this.timer) {
			clearTimeout(this.timer)
			this.timer = null
		}
		this.setState('offline')
	}

	dispose(): void {
		this.setState('closed')
		if (this.timer) {
			clearTimeout(this.timer)
			this.timer = null
		}
		if (typeof globalThis.removeEventListener === 'function') {
			if (this.onlineHandler) globalThis.removeEventListener('online', this.onlineHandler)
			if (this.offlineHandler) globalThis.removeEventListener('offline', this.offlineHandler)
		}
		this.stateListeners = []
		this.connectFn = null
	}
}
