import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { SignalDocksReporter } from '../../src/reporters/SignalDocksReporter'
import type { ProbeResult } from '../../src/core/types'

const PING_URL = 'https://app.signaldocks.com/api/monitors/abc/ping'

function makeResult(overrides?: Partial<ProbeResult>): ProbeResult {
  return {
    name: 'pg',
    status: 'up',
    responseTimeMs: 5,
    timestamp: new Date().toISOString(),
    error: null,
    metadata: {},
    ...overrides,
  }
}

describe('SignalDocksReporter', () => {
  let emitter: EventEmitter
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    emitter = new EventEmitter()
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('GETs ping URL when status is up', async () => {
    new SignalDocksReporter(emitter, { monitors: { pg: PING_URL } })
    emitter.emit('result', makeResult({ status: 'up' }))
    await new Promise(r => setTimeout(r, 0))
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][0]).toBe(PING_URL)
  })

  it('skips GET when status is down', async () => {
    new SignalDocksReporter(emitter, { monitors: { pg: PING_URL } })
    emitter.emit('result', makeResult({ status: 'down' }))
    await new Promise(r => setTimeout(r, 0))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('warns when probe name not in monitors map', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    new SignalDocksReporter(emitter, { monitors: {} })
    emitter.emit('result', makeResult({ name: 'unknown' }))
    expect(warnSpy).toHaveBeenCalledOnce()
    expect(warnSpy.mock.calls[0][0]).toMatch(/no ping URL for probe "unknown"/)
    warnSpy.mockRestore()
  })

  it('uses the correct URL per probe name', async () => {
    const REDIS_URL = 'https://app.signaldocks.com/api/monitors/xyz/ping'
    new SignalDocksReporter(emitter, { monitors: { pg: PING_URL, redis: REDIS_URL } })
    emitter.emit('result', makeResult({ name: 'redis', status: 'up' }))
    await new Promise(r => setTimeout(r, 0))
    expect(fetchMock.mock.calls[0][0]).toBe(REDIS_URL)
  })

  it('emits reporter:error on GET failure', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 })
    new SignalDocksReporter(emitter, { monitors: { pg: PING_URL } })
    const errors: unknown[] = []
    emitter.on('reporter:error', (e) => errors.push(e))
    emitter.emit('result', makeResult({ status: 'up' }))
    await new Promise(r => setTimeout(r, 0))
    expect(errors).toHaveLength(1)
    expect((errors[0] as { reporter: string }).reporter).toBe('signaldocks')
  })

  it('warns to console when no reporter:error listener on GET failure', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    new SignalDocksReporter(emitter, { monitors: { pg: PING_URL } })
    emitter.emit('result', makeResult({ status: 'up' }))
    await new Promise(r => setTimeout(r, 0))
    expect(warnSpy).toHaveBeenCalledOnce()
    expect(warnSpy.mock.calls[0][0]).toMatch(/\[db-pulse\]/)
    warnSpy.mockRestore()
  })

  it('does not crash main emitter on GET failure', async () => {
    fetchMock.mockRejectedValue(new Error('network error'))
    new SignalDocksReporter(emitter, { monitors: { pg: PING_URL } })
    emitter.on('reporter:error', () => {})
    expect(() => emitter.emit('result', makeResult({ status: 'up' }))).not.toThrow()
    await new Promise(r => setTimeout(r, 0))
  })
})
