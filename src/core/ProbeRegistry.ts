import type { ProbeFunction, ProbeConfig, RegisteredProbe } from './types'

const MIN_INTERVAL_MS = 1_000
const DEFAULT_TIMEOUT_MS = 30_000

export class ProbeRegistry {
  private readonly probes = new Map<string, RegisteredProbe>()

  register(name: string, fn: ProbeFunction, config: ProbeConfig): void {
    if (this.probes.has(name)) {
      throw new Error(`Probe "${name}" is already registered`)
    }
    if (config.interval < MIN_INTERVAL_MS) {
      throw new Error(
        `Probe "${name}" interval must be >= ${MIN_INTERVAL_MS}ms (got ${config.interval}ms)`
      )
    }
    this.probes.set(name, {
      name,
      fn,
      config: {
        interval: config.interval,
        timeout: config.timeout ?? DEFAULT_TIMEOUT_MS,
      },
    })
  }

  getAll(): RegisteredProbe[] {
    return [...this.probes.values()]
  }

  has(name: string): boolean {
    return this.probes.has(name)
  }

  clear(): void {
    this.probes.clear()
  }
}
