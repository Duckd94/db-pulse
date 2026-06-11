import { performance } from 'node:perf_hooks'
import type { RegisteredProbe, ProbeResult } from './types'

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timerId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timerId = setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
  })
  return Promise.race([
    promise.finally(() => {
      if (timerId !== undefined) clearTimeout(timerId)
    }),
    timeout,
  ])
}

export class ProbeRunner {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()

  async runOnce(probe: RegisteredProbe): Promise<ProbeResult> {
    const { name, fn, config } = probe
    const start = performance.now()

    try {
      const result = await withTimeout(fn(), config.timeout)
      const elapsed = performance.now() - start
      const metadata: Record<string, unknown> = result ? result.metadata ?? {} : {}

      return {
        name,
        status: 'up',
        responseTimeMs: Math.round(elapsed),
        timestamp: new Date().toISOString(),
        error: null,
        metadata,
      }
    } catch (err) {
      const elapsed = performance.now() - start
      return {
        name,
        status: 'down',
        responseTimeMs: Math.round(elapsed),
        timestamp: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err),
        metadata: {},
      }
    }
  }

  start(probe: RegisteredProbe, onResult: (result: ProbeResult) => void): void {
    if (this.timers.has(probe.name)) return

    const tick = async () => {
      const result = await this.runOnce(probe)
      onResult(result)

      if (this.timers.has(probe.name)) {
        const handle = setTimeout(tick, probe.config.interval)
        this.timers.set(probe.name, handle)
      }
    }

    // First tick fires immediately (delay 0); subsequent ticks use config.interval
    this.timers.set(probe.name, setTimeout(tick, 0))
  }

  stop(name: string): void {
    const handle = this.timers.get(name)
    if (handle !== undefined) {
      clearTimeout(handle)
      this.timers.delete(name)
    }
  }

  stopAll(): void {
    for (const name of [...this.timers.keys()]) {
      this.stop(name)
    }
  }

  isRunning(name: string): boolean {
    return this.timers.has(name)
  }
}
