import { describe, it, expect, beforeEach } from 'vitest'
import { ProbeRegistry } from '../../src/core/ProbeRegistry'

describe('ProbeRegistry', () => {
  let registry: ProbeRegistry

  beforeEach(() => {
    registry = new ProbeRegistry()
  })

  it('registers a probe with valid config', () => {
    registry.register('pg', async () => {}, { interval: 5_000 })
    expect(registry.has('pg')).toBe(true)
  })

  it('throws on duplicate name', () => {
    registry.register('pg', async () => {}, { interval: 5_000 })
    expect(() => registry.register('pg', async () => {}, { interval: 5_000 }))
      .toThrow('already registered')
  })

  it('throws when interval < 1000ms', () => {
    expect(() => registry.register('pg', async () => {}, { interval: 999 }))
      .toThrow('interval must be >= 1000ms')
  })

  it('allows interval exactly 1000ms', () => {
    expect(() => registry.register('pg', async () => {}, { interval: 1_000 }))
      .not.toThrow()
  })

  it('applies default 30s timeout when not provided', () => {
    registry.register('pg', async () => {}, { interval: 5_000 })
    expect(registry.getAll()[0].config.timeout).toBe(30_000)
  })

  it('uses custom timeout when provided', () => {
    registry.register('pg', async () => {}, { interval: 5_000, timeout: 10_000 })
    expect(registry.getAll()[0].config.timeout).toBe(10_000)
  })

  it('getAll returns all registered probes in order', () => {
    registry.register('pg', async () => {}, { interval: 5_000 })
    registry.register('redis', async () => {}, { interval: 10_000 })
    const probes = registry.getAll()
    expect(probes).toHaveLength(2)
    expect(probes[0].name).toBe('pg')
    expect(probes[1].name).toBe('redis')
  })

  it('has() returns false for unregistered name', () => {
    expect(registry.has('unknown')).toBe(false)
  })

  it('clear() removes all probes', () => {
    registry.register('pg', async () => {}, { interval: 5_000 })
    registry.clear()
    expect(registry.getAll()).toHaveLength(0)
    expect(registry.has('pg')).toBe(false)
  })

  it('can register again after clear()', () => {
    registry.register('pg', async () => {}, { interval: 5_000 })
    registry.clear()
    expect(() => registry.register('pg', async () => {}, { interval: 5_000 }))
      .not.toThrow()
  })
})
