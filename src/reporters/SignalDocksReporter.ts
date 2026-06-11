import type { EventEmitter } from 'node:events'
import type { ProbeResult, SignalDocksOptions } from '../core/types'

async function getURL(url: string): Promise<void> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

export class SignalDocksReporter {
  constructor(
    emitter: EventEmitter,
    private readonly options: SignalDocksOptions,
  ) {
    emitter.on('result', (result: ProbeResult) => {
      this.handleResult(emitter, result)
    })
  }

  private handleResult(emitter: EventEmitter, result: ProbeResult): void {
    const pingUrl = this.options.monitors[result.name]

    if (!pingUrl) {
      console.warn(`[db-pulse] SignalDocks: no ping URL for probe "${result.name}"`)
      return
    }

    if (result.status === 'down') return

    getURL(pingUrl).catch((err: unknown) => {
      const error = err instanceof Error ? err : new Error(String(err))
      if (emitter.listenerCount('reporter:error') === 0) {
        console.warn('[db-pulse] SignalDocks ping failed (no reporter:error listener):', error.message)
      }
      emitter.emit('reporter:error', { reporter: 'signaldocks', url: pingUrl, error, result })
    })
  }
}
