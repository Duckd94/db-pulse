# Plan: db-pulse — npm Package

**Repo**: Riêng (open-source, publish lên npm)
**Complexity**: Medium–Low
**Estimated**: 2.5–3 ngày cho v1.0.0

---

## Requirements

1. **npm package** — user `npm install db-pulse`, dùng trong code của họ
2. **Core loop**: User viết hàm query bất kỳ → `register()` với interval → package tự chạy loop, không cần external cron
3. **Event listener**: Mỗi lần chạy xong emit event `result` → user `.on('result', fn)` để tự xử lý logic
4. **Webhook reporter**: Built-in gửi kết quả ra HTTP endpoint, payload **phải có `name`** để bên nhận phân biệt từng monitor
5. **SignalDocks integration**: Chỉ là một reporter kế thừa cơ chế webhook, map `probeName → pingKey`
6. **Scope**: Tập trung core + webhook trước. SignalDocks chỉ là thin layer phía trên.

---

## Public API Design

```typescript
import { DbPulse } from 'db-pulse'  // class name giữ PascalCase

const probe = new DbPulse()

// User tự viết hàm check — throw = down, return = up
probe.register('postgres-main', async () => {
  const start = Date.now()
  await pool.query('SELECT 1')
  return { responseTimeMs: Date.now() - start, metadata: { region: 'ap-1' } }
}, { interval: 60_000 })

probe.register('redis-cache', async () => {
  await redis.ping()
}, { interval: 30_000 })

// 1. Event listener — user tự xử lý logic
probe.on('result', (result) => {
  // result.name, result.status, result.responseTimeMs, result.error
  if (result.status === 'down') myPager.alert(result)
})

// 2. Generic webhook — payload chứa `name` để bên nhận biết monitor nào
probe.useWebhook('https://my-server.com/db-status', {
  headers: { 'x-secret': 'xxx' },
  onlyOnChange: true,  // chỉ gửi khi status thay đổi (tuỳ chọn)
})

// 3. SignalDocks reporter — kế thừa webhook, map name → pingKey
probe.useSignalDocks({
  monitors: {
    'postgres-main': 'https://app.signaldocks.com/api/monitors/abc/ping',
    'redis-cache':   'https://app.signaldocks.com/api/monitors/xyz/ping',
  }
})

probe.start()
probe.stop() // graceful shutdown
```

---

## Core Types (Public API)

```typescript
// Hàm user viết — throw = down, return = up
type ProbeFunction = () => Promise<
  { responseTimeMs?: number; metadata?: Record<string, unknown> } | void
>

interface ProbeConfig {
  interval: number   // ms, minimum 1000
  timeout?: number   // ms, default 30_000 — force abort nếu hàm quá lâu
}

// Kết quả mỗi lần chạy — emitted & sent to webhooks
interface ProbeResult {
  name: string
  status: 'up' | 'down'
  responseTimeMs: number | null
  timestamp: string                      // ISO 8601
  error: string | null
  metadata: Record<string, unknown>
}

// Webhook payload = ProbeResult (name là field bắt buộc để phân biệt monitor)
type WebhookPayload = ProbeResult
```

---

## Project Structure

```
db-pulse/
├── src/
│   ├── core/
│   │   ├── ProbeRunner.ts      # interval loop, timeout, error catch
│   │   ├── ProbeRegistry.ts    # lưu danh sách probes đã register
│   │   └── types.ts            # tất cả public types
│   ├── reporters/
│   │   ├── WebhookReporter.ts      # HTTP POST với payload ProbeResult
│   │   └── SignalDocksReporter.ts  # map name → pingKey, dùng WebhookReporter
│   ├── DbProbe.ts              # main class, extends EventEmitter
│   └── index.ts                # re-export public API
├── tests/
│   ├── core/
│   │   ├── ProbeRunner.test.ts
│   │   └── ProbeRegistry.test.ts
│   └── reporters/
│       ├── WebhookReporter.test.ts
│       └── SignalDocksReporter.test.ts
├── package.json
├── tsconfig.json
├── tsup.config.ts              # build ESM + CJS
└── README.md
```

---

## Implementation Phases

### Phase 1: Core Loop + Event Emitter

**Files:** `ProbeRegistry.ts`, `ProbeRunner.ts`, `DbProbe.ts`

- `register(name, fn, config)` — lưu vào registry, validate interval ≥ 1000ms, tên phải unique
- `start()` — khởi động loop cho mỗi probe:
  - Dùng `setTimeout` đệ quy (không dùng `setInterval`) để tránh overlap khi fn chạy lâu hơn interval
  - Chạy fn ngay lần đầu, sau đó lặp theo interval
- `stop()` — clear tất cả timers, graceful shutdown
- Mỗi lần chạy:
  1. `performance.now()` trước/sau fn để đo `responseTimeMs`
  2. `Promise.race([fn(), abortAfter(timeout)])` — force down nếu timeout
  3. `try/catch` — throw = `status: 'down'`, return = `status: 'up'`
  4. Emit event `result` với `ProbeResult`
- **Validate**: tên probe unique, interval ≥ 1000ms

### Phase 2: Webhook Reporter

**File:** `WebhookReporter.ts`

- `probe.useWebhook(url, options?)` — đăng ký reporter
- Listen `result` event → `fetch(url, { method: 'POST', body: JSON.stringify(result) })`
- Option `onlyOnChange`: track `Map<name, lastStatus>`, chỉ POST khi `up→down` hoặc `down→up`
- Retry 1 lần nếu HTTP request fail (sau 1s)
- Fail silently (không crash loop chính), nhưng emit `reporter:error` event để user debug

### Phase 3: SignalDocks Reporter

**File:** `SignalDocksReporter.ts`

- `probe.useSignalDocks({ monitors: { [name]: pingUrl } })`
- Listen `result` event
- Nếu `status === 'up'` → `GET pingUrl` (heartbeat tới SignalDocks)
- Nếu `status === 'down'` → không gọi (SignalDocks tự detect hết grace period → alert)
- Log warning nếu `name` không có trong `monitors` map
- Dùng lại logic HTTP từ `WebhookReporter` (kế thừa hoặc compose)

---

## Files to Change (SignalDocks side — Phase sau)

Phần này chỉ implement khi db-pulse core đã stable. Không làm song song.

| File | Action | Why |
|---|---|---|
| `app/api/db-pulse/push/route.ts` | CREATE | Nhận rich metrics từ db-pulse thay vì chỉ heartbeat |
| `types/index.ts` | UPDATE | Thêm `DbProbePayload` interface |
| `supabase/migrations/xxx_db_probe.sql` | CREATE | Lưu check results từ db-pulse |

---

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Interval drift khi fn chạy lâu hơn interval | Medium | Dùng `setTimeout` đệ quy, mỗi tick đặt lại timer sau khi fn kết thúc |
| Memory leak nếu nhiều probe không `stop()` | Medium | Document `stop()`, clear timer references sau stop |
| `reporter:error` không được handle → silent fail | Medium | Emit event + warn to console nếu không có listener |
| npm package name `db-pulse` đã tồn tại | Low | Check `npm info db-pulse` trước khi tạo repo |

---

## Validation

```bash
# Sau Phase 1
npx vitest run

# Sau Phase 2–3
npx vitest run
npm pack --dry-run   # kiểm tra files được publish

# Publish
npm publish --access public
```

## Acceptance Criteria

- [ ] `register()` + `start()` chạy loop đúng interval
- [ ] Throw trong probe fn → emit `result` với `status: 'down'`
- [ ] Timeout → emit `result` với `status: 'down'`, `error: 'Timeout after Xms'`
- [ ] `useWebhook()` POST đúng payload với `name` field
- [ ] `onlyOnChange: true` chỉ POST khi status thay đổi
- [ ] `useSignalDocks()` GET ping URL khi up, bỏ qua khi down
- [ ] `stop()` dừng tất cả loops, không leak timer
- [ ] Build ra cả ESM + CJS
- [ ] 80%+ test coverage
