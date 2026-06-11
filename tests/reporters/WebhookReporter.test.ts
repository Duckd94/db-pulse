import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import { WebhookReporter } from '../../src/reporters/WebhookReporter'
import type { ProbeResult } from '../../src/core/types'

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

describe('WebhookReporter', () => {
  let emitter: EventEmitter
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    emitter = new EventEmitter()
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchMock)
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('POSTs result JSON on each result event', async () => {
    new WebhookReporter(emitter, 'https://example.com/hook')
    emitter.emit('result', makeResult())
    await vi.runAllTimersAsync()
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://example.com/hook')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body)
    expect(body.name).toBe('pg')
    expect(body.status).toBe('up')
  })

  it('includes custom headers', async () => {
    new WebhookReporter(emitter, 'https://example.com/hook', {
      headers: { 'x-secret': 'tok123' },
    })
    emitter.emit('result', makeResult())
    await vi.runAllTimersAsync()
    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers['x-secret']).toBe('tok123')
  })

  it('always sets Content-Type: application/json', async () => {
    new WebhookReporter(emitter, 'https://example.com/hook')
    emitter.emit('result', makeResult())
    await vi.runAllTimersAsync()
    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers['Content-Type']).toBe('application/json')
  })

  describe('onlyOnChange', () => {
    it('does not POST when status is unchanged', async () => {
      new WebhookReporter(emitter, 'https://example.com/hook', { onlyOnChange: true })
      emitter.emit('result', makeResult({ status: 'up' }))
      emitter.emit('result', makeResult({ status: 'up' }))
      await vi.runAllTimersAsync()
      expect(fetchMock).toHaveBeenCalledOnce()
    })

    it('POSTs on up→down flip', async () => {
      new WebhookReporter(emitter, 'https://example.com/hook', { onlyOnChange: true })
      emitter.emit('result', makeResult({ status: 'up' }))
      emitter.emit('result', makeResult({ status: 'down' }))
      await vi.runAllTimersAsync()
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('POSTs on down→up flip', async () => {
      new WebhookReporter(emitter, 'https://example.com/hook', { onlyOnChange: true })
      emitter.emit('result', makeResult({ status: 'down' }))
      emitter.emit('result', makeResult({ status: 'up' }))
      await vi.runAllTimersAsync()
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('tracks status per probe name independently', async () => {
      new WebhookReporter(emitter, 'https://example.com/hook', { onlyOnChange: true })
      emitter.emit('result', makeResult({ name: 'pg', status: 'up' }))
      emitter.emit('result', makeResult({ name: 'redis', status: 'up' }))
      emitter.emit('result', makeResult({ name: 'pg', status: 'up' }))   // same — skip
      emitter.emit('result', makeResult({ name: 'redis', status: 'down' })) // changed — send
      await vi.runAllTimersAsync()
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })
  })

  describe('retry on failure', () => {
    it('retries once after 1s on HTTP error', async () => {
      fetchMock
        .mockResolvedValueOnce({ ok: false, status: 500 })
        .mockResolvedValueOnce({ ok: true, status: 200 })
      new WebhookReporter(emitter, 'https://example.com/hook')
      emitter.emit('result', makeResult())
      await vi.advanceTimersByTimeAsync(1_500)
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('emits reporter:error after both attempts fail', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 503 })
      new WebhookReporter(emitter, 'https://example.com/hook')
      const errors: unknown[] = []
      emitter.on('reporter:error', (e) => errors.push(e))
      emitter.emit('result', makeResult())
      await vi.advanceTimersByTimeAsync(1_500)
      expect(errors).toHaveLength(1)
      expect((errors[0] as { reporter: string }).reporter).toBe('webhook')
    })

    it('warns to console when no reporter:error listener is attached', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 503 })
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      new WebhookReporter(emitter, 'https://example.com/hook')
      emitter.emit('result', makeResult())
      await vi.advanceTimersByTimeAsync(1_500)
      expect(warnSpy).toHaveBeenCalledOnce()
      expect(warnSpy.mock.calls[0][0]).toMatch(/\[db-pulse\]/)
      warnSpy.mockRestore()
    })

    it('does not crash main emitter on delivery failure', async () => {
      fetchMock.mockRejectedValue(new Error('network down'))
      new WebhookReporter(emitter, 'https://example.com/hook')
      emitter.on('reporter:error', () => {})
      expect(() => emitter.emit('result', makeResult())).not.toThrow()
      await vi.advanceTimersByTimeAsync(1_500)
    })
  })
})
