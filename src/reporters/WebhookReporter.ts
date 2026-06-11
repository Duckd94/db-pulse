import type { EventEmitter } from 'node:events'
import type { ProbeResult, WebhookOptions } from '../core/types'

const RETRY_DELAY_MS = 1_000

async function postJSON(url: string, payload: ProbeResult, headers: Record<string, string>): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
}

export class WebhookReporter {
  private readonly lastStatus = new Map<string, 'up' | 'down'>()

  constructor(
    emitter: EventEmitter,
    private readonly url: string,
    private readonly options: WebhookOptions = {},
  ) {
    emitter.on('result', (result: ProbeResult) => {
      this.handleResult(emitter, result)
    })
  }

  private handleResult(emitter: EventEmitter, result: ProbeResult): void {
    const { onlyOnChange } = this.options

    if (onlyOnChange) {
      const last = this.lastStatus.get(result.name)
      if (last === result.status) return
      this.lastStatus.set(result.name, result.status)
    }

    this.send(emitter, result)
  }

  private send(emitter: EventEmitter, result: ProbeResult): void {
    const headers = this.options.headers ?? {}
    postJSON(this.url, result, headers).catch(() => {
      // Retry once after RETRY_DELAY_MS
      setTimeout(() => {
        postJSON(this.url, result, headers).catch((err: unknown) => {
          const error = err instanceof Error ? err : new Error(String(err))
          if (emitter.listenerCount('reporter:error') === 0) {
            console.warn('[db-pulse] Webhook delivery failed (no reporter:error listener):', error.message)
          }
          emitter.emit('reporter:error', { reporter: 'webhook', url: this.url, error, result })
        })
      }, RETRY_DELAY_MS)
    })
  }
}
