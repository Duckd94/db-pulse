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
    vi.unstubAllGlobals()
  })

  it('register() returns this for chaining', () => {
    expect(probe.register('pg', async () => {}, { interval: 5_000 })).toBe(probe)
  })

  it('start() returns this for chaining', () => {
    probe.register('pg', async () => {}, { interval: 5_000 })
    expect(probe.start()).toBe(probe)
  })

  it('stop() returns this for chaining', () => {
    expect(probe.stop()).toBe(probe)
  })

  it('emits result event after start()', async () => {
    probe.register('pg', async () => {}, { interval: 5_000 })
    const results: ProbeResult[] = []
    probe.on('result', (r: ProbeResult) => results.push(r))
    probe.start()
    await vi.advanceTimersByTimeAsync(0)
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

  it('start() is idempotent', async () => {
    probe.register('pg', async () => {}, { interval: 5_000 })
    const results: ProbeResult[] = []
    probe.on('result', (r: ProbeResult) => results.push(r))
    probe.start()
    probe.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(results).toHaveLength(1)
  })

  it('stop() halts further events', async () => {
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

  it('useWebhook() returns this for chaining', () => {
    expect(probe.useWebhook('https://example.com/hook')).toBe(probe)
  })

  it('useWebhook() POSTs result when probe fires', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)
    probe.register('pg', async () => {}, { interval: 5_000 })
    probe.useWebhook('https://example.com/hook')
    probe.start()
    await vi.advanceTimersByTimeAsync(0)
    await Promise.resolve()
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
