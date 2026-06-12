# db-pulse

> Zero-dependency health-check loops for Node.js — register any async function, get results as events.

[![npm version](https://img.shields.io/npm/v/db-pulse.svg)](https://www.npmjs.com/package/db-pulse)
[![license](https://img.shields.io/npm/l/db-pulse.svg)](LICENSE)
[![node](https://img.shields.io/node/v/db-pulse.svg)](package.json)

**db-pulse** runs your health-check functions on configurable intervals — no external cron, no infrastructure. Every result is emitted as an event so you can route it anywhere: alert, log, webhook, or uptime service.

```
probe fn throws → status: "down"  ──► emit "result"
probe fn returns → status: "up"   ──► emit "result"  ──► useWebhook()  → POST to your server
                                                     ──► useSignalDocks() → GET ping URL
```

---

## Install

```bash
npm install db-pulse
```

Requires **Node.js ≥ 18** (uses native `fetch` and `EventEmitter`).

---

## Quick start

```ts
import { DbPulse } from 'db-pulse'

const pulse = new DbPulse()

// Register any async function — throw = down, return = up
pulse.register('postgres', async () => {
  await pool.query('SELECT 1')
}, { interval: 60_000 })          // run every 60 s

pulse.register('redis', async () => {
  await redis.ping()
}, { interval: 30_000 })          // run every 30 s

// Listen to every result
pulse.on('result', (result) => {
  console.log(`[${result.name}] ${result.status} — ${result.responseTimeMs}ms`)
  if (result.status === 'down') pagerDuty.alert(result)
})

pulse.start()
```

---

## How it works

1. **Register** a probe: any `async () => Promise<...>` function.
2. **Start** — each probe fires immediately, then again every `interval` ms.
3. **No overlap** — the next tick is scheduled _after_ the current run finishes (recursive `setTimeout`, not `setInterval`).
4. **Timeout guard** — if a probe runs longer than `timeout` (default 30 s), it is force-aborted and marked `down`.
5. **Result event** — every run emits a `result` event with a `ProbeResult` object regardless of outcome.
6. **Reporters** — `useWebhook()` and `useSignalDocks()` attach listeners that forward results to external systems.
7. **Stop** — `pulse.stop()` clears all timers gracefully.

---

## API

### `new DbPulse()`

Creates a new pulse instance. Extends `EventEmitter`.

---

### `pulse.register(name, fn, config)`

Register a health-check function.

| Parameter | Type | Description |
|---|---|---|
| `name` | `string` | Unique probe identifier. Used in `ProbeResult.name` and webhook payloads. |
| `fn` | `async () => ProbeReturn \| void` | Your check function. Throw to signal down; return to signal up. |
| `config.interval` | `number` (ms) | How often to run. Minimum **1000 ms**. |
| `config.timeout` | `number` (ms) | Abort after this long. Default **30 000 ms**. |

```ts
pulse.register('pg-primary', async () => {
  const t = Date.now()
  await pool.query('SELECT 1')
  return { metadata: { queryMs: Date.now() - t } }
}, { interval: 60_000, timeout: 5_000 })
```

Returns `this` — chainable.

---

### `pulse.start()`

Start all registered probes. Calling `start()` multiple times is safe (idempotent).

Returns `this`.

---

### `pulse.stop()`

Stop all probe loops. No more `result` events will fire after `stop()` resolves. Safe to call before any probes have started.

Returns `this`.

---

### `pulse.on('result', (result: ProbeResult) => void)`

Fired after every probe run — both `up` and `down`.

```ts
pulse.on('result', (result) => {
  metrics.gauge('probe.response_ms', result.responseTimeMs ?? 0, { probe: result.name })
  if (result.status === 'down') alerts.fire(result.name, result.error)
})
```

---

### `pulse.useWebhook(url, options?)`

Send every `ProbeResult` to an HTTP endpoint via `POST`.

| Option | Type | Default | Description |
|---|---|---|---|
| `headers` | `Record<string, string>` | `{}` | Extra request headers (auth tokens, etc.). |
| `onlyOnChange` | `boolean` | `false` | Only POST when status flips (`up→down` or `down→up`). |

```ts
pulse.useWebhook('https://my-server.com/health-events', {
  headers: { 'x-api-key': process.env.WEBHOOK_SECRET! },
  onlyOnChange: true,    // skip redundant "still up" pings
})
```

**Payload** — the full `ProbeResult` JSON, including `name`:
```json
{
  "name": "postgres",
  "status": "down",
  "responseTimeMs": 5003,
  "timestamp": "2025-06-12T08:23:01.442Z",
  "error": "Timeout after 5000ms",
  "metadata": {}
}
```

**Reliability** — failed requests are retried once after 1 s. After both attempts fail, a `reporter:error` event is emitted (never crashes the main loop).

Returns `this`.

---

### `pulse.useSignalDocks(options)`

Integrate with [SignalDocks](https://signaldocks.com) uptime monitoring.

```ts
pulse.useSignalDocks({
  monitors: {
    'postgres': 'https://app.signaldocks.com/api/monitors/abc123/ping',
    'redis':    'https://app.signaldocks.com/api/monitors/xyz789/ping',
  }
})
```

- **Up** → `GET <pingUrl>` (heartbeat — resets the grace-period timer).
- **Down** → no request (SignalDocks detects the missed heartbeat and fires an alert after the grace period).

Returns `this`.

---

### `pulse.on('reporter:error', (detail) => void)`

Fired when a webhook POST or SignalDocks GET fails after all retries.

```ts
pulse.on('reporter:error', ({ reporter, url, error, result }) => {
  logger.warn({ reporter, url, probe: result.name }, `reporter failed: ${error.message}`)
})
```

If no listener is attached, db-pulse logs a warning to `console.warn` so failures are never silently swallowed.

---

## ProbeResult shape

```ts
interface ProbeResult {
  name: string                        // probe identifier from register()
  status: 'up' | 'down'
  responseTimeMs: number | null       // wall-clock ms, measured by the runner
  timestamp: string                   // ISO 8601
  error: string | null                // error message when status === 'down'
  metadata: Record<string, unknown>   // anything you return from your fn
}
```

---

## Recipes

### Route down events to Slack

```ts
pulse.on('result', async (result) => {
  if (result.status === 'down') {
    await fetch(process.env.SLACK_WEBHOOK!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `:red_circle: *${result.name}* is DOWN\n\`${result.error}\``
      }),
    })
  }
})
```

### Store results in a database

```ts
pulse.on('result', (result) => {
  db.insert('probe_results', result)
})
```

### Graceful shutdown

```ts
process.on('SIGTERM', () => {
  pulse.stop()
  server.close(() => process.exit(0))
})
```

### Multiple webhooks

```ts
pulse
  .useWebhook('https://ops-team.example.com/alerts', { onlyOnChange: true })
  .useWebhook('https://logs.example.com/ingest')          // all results
  .useSignalDocks({ monitors: { postgres: PING_URL } })
  .start()
```

### Timeout per probe

```ts
// Fast check — abort if it takes more than 3 s
pulse.register('redis-cache', async () => {
  await redis.ping()
}, { interval: 10_000, timeout: 3_000 })

// Slow check — allow up to 45 s for a heavy query
pulse.register('analytics-db', async () => {
  await analytics.query('SELECT count(*) FROM events')
}, { interval: 300_000, timeout: 45_000 })
```

---

## TypeScript

db-pulse ships its own types — no `@types/*` needed.

```ts
import { DbPulse } from 'db-pulse'
import type { ProbeResult, ProbeConfig, WebhookOptions } from 'db-pulse'
```

---

## License

MIT © [Duckd94](https://github.com/Duckd94)
