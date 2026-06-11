import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DbPulse } from '../src/DbPulse'
import type { ProbeResult } from '../src/core/types'

describe('DbPulse', () => {
  let probe: DbPulse

  beforeEach(() => {
    probe = new DbPulse()
    vi.useFakeTimers()
  })

  afterEach(() => {
    probe.stop()
    vi.useRealTimers()
  })

  it('register() returns this for chaining', () => {
    const result = probe.register('pg', async () => {}, { interval: 5_000 })
    expect(result).toBe(probe)
  })

  it('start() returns this for chaining', () => {
    probe.register('pg', async () => {}, { interval: 5_000 })
    const result = probe.start()
    expect(result).toBe(probe)
  })

  it('stop() returns this for chaining', () => {
    const result = probe.stop()
    expect(result).toBe(probe)
  })

  it('emits result event after start()', async () => {
    probe.register('pg', async () => {}, { interval: 5_000 })
    const results: ProbeResult[] = []
    probe.on('result', (r: ProbeResult) => results.push(r))
    probe.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(results).toHaveLength(1)
    expect(results[0].name).toBe('pg')
  })

  it('emits status:down when probe fn throws', async () => {
    probe.register('broken', async () => { throw new Error('db unreachable') }, { interval: 5_000 })
    const results: ProbeResult[] = []
    probe.on('result', (r: ProbeResult) => results.push(r))
    probe.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(results[0].status).toBe('down')
    expect(results[0].error).toBe('db unreachable')
  })

  it('start() is idempotent — calling twice does not double-register loops', async () => {
    probe.register('pg', async () => {}, { interval: 5_000 })
    const results: ProbeResult[] = []
    probe.on('result', (r: ProbeResult) => results.push(r))
    probe.start()
    probe.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(results).toHaveLength(1)
  })

  it('stop() halts the loop so no further events fire', async () => {
    probe.register('pg', async () => {}, { interval: 5_000 })
    const results: ProbeResult[] = []
    probe.on('result', (r: ProbeResult) => results.push(r))
    probe.start()
    await vi.advanceTimersByTimeAsync(0)
    probe.stop()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(results).toHaveLength(1)
  })

  it('supports multiple registered probes', async () => {
    probe.register('pg', async () => {}, { interval: 5_000 })
    probe.register('redis', async () => {}, { interval: 5_000 })
    const names: string[] = []
    probe.on('result', (r: ProbeResult) => names.push(r.name))
    probe.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(names).toContain('pg')
    expect(names).toContain('redis')
  })
})
