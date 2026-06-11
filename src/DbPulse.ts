import { EventEmitter } from 'node:events'
import { ProbeRegistry } from './core/ProbeRegistry'
import { ProbeRunner } from './core/ProbeRunner'
import type { ProbeFunction, ProbeConfig } from './core/types'

export class DbPulse extends EventEmitter {
  private readonly registry = new ProbeRegistry()
  private readonly runner = new ProbeRunner()
  private running = false

  register(name: string, fn: ProbeFunction, config: ProbeConfig): this {
    this.registry.register(name, fn, config)
    return this
  }

  start(): this {
    if (this.running) return this
    this.running = true
    for (const probe of this.registry.getAll()) {
      this.runner.start(probe, (result) => {
        this.emit('result', result)
      })
    }
    return this
  }

  stop(): this {
    this.runner.stopAll()
    this.running = false
    return this
  }
}
