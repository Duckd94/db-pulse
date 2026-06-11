import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ProbeRunner } from '../../src/core/ProbeRunner'
import type { RegisteredProbe } from '../../src/core/types'

function makeProbe(overrides?: Partial<RegisteredProbe>): RegisteredProbe {
  return {
    name: 'test-probe',
    fn: async () => {},
    config: { interval: 5_000, timeout: 1_000 },
    ...overrides,
  }
}

describe('ProbeRunner', () => {
  let runner: ProbeRunner

  beforeEach(() => {
    runner = new ProbeRunner()
    vi.useFakeTimers()
  })

  afterEach(() => {
    runner.stopAll()
    vi.useRealTimers()
  })

  describe('runOnce()', () => {
    it('returns status:up for a successful fn', async () => {
      const probe = makeProbe({ fn: async () => ({ metadata: { region: 'ap-1' } }) })
      const result = await runner.runOnce(probe)
      expect(result.status).toBe('up')
      expect(result.error).toBeNull()
      expect(result.metadata).toEqual({ region: 'ap-1' })
    })

    it('returns status:up when fn returns void', async () => {
      const probe = makeProbe({ fn: async () => {} })
      const result = await runner.runOnce(probe)
      expect(result.status).toBe('up')
      expect(result.metadata).toEqual({})
    })

    it('returns status:down when fn throws an Error', async () => {
      const probe = makeProbe({
        fn: async () => { throw new Error('connection refused') },
      })
      const result = await runner.runOnce(probe)
      expect(result.status).toBe('down')
      expect(result.error).toBe('connection refused')
    })

    it('returns status:down when fn throws a non-Error', async () => {
      const probe = makeProbe({ fn: async () => { throw 'boom' } })
      const result = await runner.runOnce(probe)
      expect(result.status).toBe('down')
      expect(result.error).toBe('boom')
    })

    it('returns status:down on timeout', async () => {
      const probe = makeProbe({
        fn: () => new Promise(() => {}),
        config: { interval: 5_000, timeout: 100 },
      })
      const resultPromise = runner.runOnce(probe)
      await vi.advanceTimersByTimeAsync(200)
      const result = await resultPromise
      expect(result.status).toBe('down')
      expect(result.error).toMatch(/Timeout after 100ms/)
    })

    it('includes a numeric responseTimeMs', async () => {
      const probe = makeProbe({ fn: async () => {} })
      const result = await runner.runOnce(probe)
      expect(typeof result.responseTimeMs).toBe('number')
      expect(result.responseTimeMs).toBeGreaterThanOrEqual(0)
    })

    it('includes an ISO 8601 timestamp', async () => {
      const probe = makeProbe({ fn: async () => {} })
      const result = await runner.runOnce(probe)
      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    })

    it('includes probe name in result', async () => {
      const probe = makeProbe({ name: 'my-db' })
      const result = await runner.runOnce(probe)
      expect(result.name).toBe('my-db')
    })
  })

  describe('start() / stop()', () => {
    it('calls onResult on the first tick (delay 0)', async () => {
      const probe = makeProbe()
      const onResult = vi.fn()
      runner.start(probe, onResult)
      await vi.advanceTimersByTimeAsync(0)
      expect(onResult).toHaveBeenCalledTimes(1)
    })

    it('calls onResult again after the configured interval', async () => {
      const probe = makeProbe({ config: { interval: 5_000, timeout: 30_000 } })
      const onResult = vi.fn()
      runner.start(probe, onResult)
      await vi.advanceTimersByTimeAsync(0)       // first tick
      await vi.advanceTimersByTimeAsync(5_000)   // second tick
      expect(onResult).toHaveBeenCalledTimes(2)
    })

    it('does not schedule a third tick before the interval elapses', async () => {
      const probe = makeProbe({ config: { interval: 5_000, timeout: 30_000 } })
      const onResult = vi.fn()
      runner.start(probe, onResult)
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(4_999)
      expect(onResult).toHaveBeenCalledTimes(1)
    })

    it('does not call onResult after stop()', async () => {
      const probe = makeProbe({ config: { interval: 5_000, timeout: 30_000 } })
      const onResult = vi.fn()
      runner.start(probe, onResult)
      await vi.advanceTimersByTimeAsync(0)
      runner.stop(probe.name)
      await vi.advanceTimersByTimeAsync(5_000)
      expect(onResult).toHaveBeenCalledTimes(1)
    })

    it('stopAll() stops every running probe', async () => {
      const onResult = vi.fn()
      runner.start(makeProbe({ name: 'a', config: { interval: 5_000, timeout: 30_000 } }), onResult)
      runner.start(makeProbe({ name: 'b', config: { interval: 5_000, timeout: 30_000 } }), onResult)
      await vi.advanceTimersByTimeAsync(0)   // both first ticks
      runner.stopAll()
      await vi.advanceTimersByTimeAsync(5_000)
      expect(onResult).toHaveBeenCalledTimes(2)
    })

    it('start() is idempotent — calling twice does not double-fire', async () => {
      const probe = makeProbe({ config: { interval: 5_000, timeout: 30_000 } })
      const onResult = vi.fn()
      runner.start(probe, onResult)
      runner.start(probe, onResult) // second call ignored
      await vi.advanceTimersByTimeAsync(0)
      expect(onResult).toHaveBeenCalledTimes(1)
    })

    it('isRunning() returns true after start, false after stop', () => {
      const probe = makeProbe()
      runner.start(probe, vi.fn())
      expect(runner.isRunning(probe.name)).toBe(true)
      runner.stop(probe.name)
      expect(runner.isRunning(probe.name)).toBe(false)
    })

    it('stop() on unknown name is a no-op', () => {
      expect(() => runner.stop('nonexistent')).not.toThrow()
    })

    it('emits ProbeResult shape on each tick', async () => {
      const probe = makeProbe({ name: 'pg', fn: async () => ({}) })
      const results: unknown[] = []
      runner.start(probe, (r) => results.push(r))
      await vi.advanceTimersByTimeAsync(0)
      expect(results[0]).toMatchObject({
        name: 'pg',
        status: 'up',
        error: null,
      })
    })
  })
})
