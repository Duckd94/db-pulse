# CLAUDE.md — db-pulse

## Project

`db-pulse` is a TypeScript npm package that lets users register async health-check functions and runs them on configurable intervals. Results are emitted as events and forwarded to webhook / SignalDocks reporters.

- **Publish target**: npm (public, `npm publish --access public`)
- **Language**: TypeScript 5.x
- **Runtime**: Node.js 18+
- **Module output**: ESM + CJS dual (via tsup)

---

## Commands

| Task | Command |
|---|---|
| Build | `npm run build` |
| Test | `npx vitest run` |
| Test watch | `npx vitest` |
| Test coverage | `npx vitest run --coverage` |
| Type-check | `npx tsc --noEmit` |
| Lint | `npx eslint src tests` |
| Pack dry-run | `npm pack --dry-run` |

---

## Architecture

```
src/
  core/
    types.ts            — all public types (ProbeFunction, ProbeConfig, ProbeResult)
    ProbeRegistry.ts    — validates + stores registered probes
    ProbeRunner.ts      — recursive setTimeout loop, timeout race, error catch
  reporters/
    WebhookReporter.ts      — HTTP POST on result event; optional onlyOnChange
    SignalDocksReporter.ts  — GET ping URL on up; skip on down
  DbPulse.ts            — main class, extends EventEmitter, wires core + reporters
  index.ts              — re-exports public API
tests/
  core/
    ProbeRunner.test.ts
    ProbeRegistry.test.ts
  reporters/
    WebhookReporter.test.ts
    SignalDocksReporter.test.ts
```

---

## Key Invariants

- `register()` validates: `interval >= 1000ms`, `name` must be unique
- `start()` uses **recursive `setTimeout`**, not `setInterval` — prevents overlap when fn runs longer than interval
- First run is **immediate** (no initial delay)
- Timeout: `Promise.race([fn(), abortAfter(timeout)])` — default 30 000 ms
- `throw` inside probe fn → `status: 'down'`; return → `status: 'up'`
- `stop()` must clear all timer references (no leaks)
- Reporters **fail silently** — never crash the main loop; emit `reporter:error` instead
- Emit `reporter:error` to console if no listener is attached (avoid silent failures)

---

## Test Strategy

- Framework: **vitest**
- Use `vi.useFakeTimers()` for timer-based tests
- Mock `fetch` with `vi.fn()` for reporter tests
- Target: **80%+ coverage**
- Test file mirrors source: `tests/core/ProbeRunner.test.ts` ↔ `src/core/ProbeRunner.ts`

---

## Phase Workflow

After **each phase**:
1. Run `npx vitest run` — all tests must pass
2. Run `npx tsc --noEmit` — zero type errors
3. Run `/code-review` — address any HIGH findings before proceeding
4. Only advance to the next phase when the current phase is clean

---

## npm Package Notes

- Package name: `db-pulse`
- Main entry: `dist/index.js` (CJS) + `dist/index.mjs` (ESM)
- Types entry: `dist/index.d.ts`
- `files` in package.json: `["dist", "README.md"]`
- Dev deps: `typescript`, `vitest`, `tsup`, `@vitest/coverage-v8`
- Zero runtime dependencies (use native `fetch`, `EventEmitter`, `performance`)
