# Phase 0–5 Code Assessment

**Date:** 2026-04-19
**Scope:** Full repo review across `@brandfactory/{shared,db,adapter-*,server,agent}`. Cross-checked against `docs/completions/phase0..phase5.md` and `docs/changelog.md`.
**Verification:** All findings confirmed by direct file read; per-package agent reports cross-validated against source.
**Verdict:** **8.7/10 overall — green-light to start Phase 6.** No blocking defects. Six tightenings worth landing as a small Phase-5.1 cleanup pass before the agent route lights up in Phase 6; rest are Phase 7/8 territory and already on the deferral list.

---

## Scoring per package

| Package | Score | Blockers? |
|---|---|---|
| `@brandfactory/shared` | 9.0 | None |
| `@brandfactory/db` | 9.0 | None |
| `@brandfactory/adapter-{auth,llm,storage}` | 9.0 | None |
| `@brandfactory/adapter-realtime` | 8.0 | One subscribe race — fix before Phase 6 wires the agent stream onto the bus |
| `@brandfactory/server` | 8.5 | None blocking; one HIGH-ish DoS-shaped gap (unbounded blob PUT body) worth a 5-line fix |
| `@brandfactory/agent` | 9.5 | None |

No source file in the repo exceeds 500 LOC. Largest is `packages/server/src/test-helpers.ts` at 301 lines, and it is appropriately cohesive — no split needed. Largest production file is `packages/agent/src/stream.ts` at 167 lines.

---

## Findings — must-fix before Phase 6

### 1. **HIGH** — Subscribe race in `adapter-realtime/native-ws.ts`

**File:** `packages/adapters/realtime/src/native-ws.ts:87-109`

The dedup check (`if (unsubscribers.has(msg.channel)) return`) runs synchronously on line 88, but the `subscribe(...)` call that populates the map happens inside the awaited `proceed()` and only completes after `opts.authorize` resolves (lines 89-107). Two `subscribe` messages for the same channel arriving in the same tick both pass the dedup check, both await authorize, and both register a handler on the channel — the client then receives every event twice (or N times for N rapid duplicates), forever, until the socket closes.

Phase 6 will start fanning agent text-deltas to the realtime bus at high rate. Any client that re-subscribes on reconnect/visibility-change can hit this — duplicate token streams in the canvas UI is exactly the symptom this manifests as.

**Fix (≤5 lines):** stake a placeholder before awaiting:

```ts
if (msg.type === 'subscribe') {
  if (unsubscribers.has(msg.channel)) return
  unsubscribers.set(msg.channel, () => {})  // claim the slot
  const proceed = async () => {
    if (opts.authorize) {
      const ok = await opts.authorize({ userId: userId!, channel: msg.channel })
      if (!ok) { unsubscribers.delete(msg.channel); return }
    }
    const off = subscribe(msg.channel, /* ... */)
    unsubscribers.set(msg.channel, off)  // replace placeholder
  }
  void proceed()
  return
}
```

Also worth: a vitest case that fires two `subscribe` messages for the same channel in one tick and asserts exactly one handler registers.

### 2. **MEDIUM** — Unbounded request body on `PUT /blobs/:key`

**File:** `packages/server/src/routes/blobs.ts:56`

`c.req.arrayBuffer()` reads the entire body into memory with no ceiling. A signed PUT URL is short-lived and gated by HMAC, so the attack surface is "an authenticated client can OOM the server", which is small but real and trivially exploitable once we hand out signed URLs to a logged-in agent. The Phase-4 changelog defers content-type/max-body to Phase 8, but a max-body limit is one constant + one length check — it shouldn't wait two phases.

**Fix:** read `content-length`, reject `> MAX_BLOB_BYTES` with 413 before reading the body. Pick a number from the env (e.g. `BLOB_MAX_BYTES`, default 25 MiB) so it's tunable per deployment.

### 3. **LOW (correctness)** — Redundant predicate in `db/queries/events.ts:56`

`listBlockEvents` does `where(and(eq(canvasEvents.blockId, blockId), isNotNull(canvasEvents.blockId)))`. The `isNotNull` is implied by the equality on a non-null value; remove it. Cosmetic, but it currently reads as if `blockId` were nullable parameter material, which it isn't.

### 4. **LOW** — `RealtimeEventPayloadSchema` overlapping branches

**File:** `packages/shared/src/realtime/envelope.ts:12-16`

`AgentEventSchema` (in `agent/events.ts:82-87`) already includes `CanvasOpEventSchema` and `PinOpEventSchema`. The envelope's `z.union([AgentEventSchema, CanvasOpEventSchema, PinOpEventSchema])` is therefore redundant — every payload that matches one of the trailing two also matches the leading one. No security impact (the union accepts the same set of values either way), but it's a structural mistake that will confuse the next reader. Drop to `payload: AgentEventSchema`.

### 5. **LOW** — `proxy-log token leak` (already on the deferral list)

**File:** `packages/server/src/ws.ts:30-38`

The `?token=` fallback is acknowledged (Phase 7 CORS + cookie ticket flow). Worth noting here only because Phase 6 starts the agent stream and the token-in-URL becomes a real production risk the moment any non-trivial deployment is on a reverse proxy that logs URLs. Not blocking — but please don't let Phase 6 ship to anything that isn't local-dev without the cookie-ticket swap.

### 6. **LOW (consistency)** — 403 vs 404 ordering in `authz.ts`

**File:** `packages/server/src/authz.ts:25-27, 36-38, 47-48`

All three `requireXAccess` helpers throw 404 when the row is missing and 403 only when it exists but the caller doesn't own it. This is a deliberate product call per the Phase-4 follow-ups list — it leaks "this id exists" to a non-owner. Same behaviour matches the WS `authorizeChannel` walk for consistency. Flagging only because Phase 6 will introduce a new public-ish surface (the agent endpoint) and now is a cheap moment to flip to "always 404 unless you own it" if the product team wants enumeration resistance. Keep as-is unless that decision is revisited.

---

## What we explicitly checked and found clean

- **All 22 server source files** — middleware ordering (request-id → logger → per-prefix auth → handler → onError) correct; `/blobs` not auth-gated (sub-app bleed fixed); shutdown ordering WS → HTTP → `pool.end()` → exit.
- **`stream.ts` correctness** — message-id allocated on first text-delta, flushed on `step-finish`/`finish` plus a trailing safeguard; `pendingByToolCall` Map cannot leak (AI-SDK guarantees `tool-result` follows `tool-call`); `error` parts re-throw out of the generator; the documented `as unknown as AsyncIterable<AgentStreamPart>` cast is the only `as`-cast in the package and it's load-bearing for the v4 type-narrowing collapse.
- **`agent` side-effect seam** — zero imports from `@brandfactory/db`, `adapter-realtime`, `node:http`, or any SDK; everything goes through `LLMProvider` + `CanvasOpApplier`. The package is genuinely pure-orchestration.
- **HMAC verify** — `verifySignature` does the full HMAC compute + `timingSafeEqual` before deciding expired-vs-tampered, so a remote observer can't distinguish via response timing. Length-mismatch path is also constant-time.
- **Path-traversal defence** — `local-disk.resolveKey` resolves against root and rejects any escape; no symlink dance possible because `resolve` doesn't follow symlinks before the check (writeFile/readFile happens at the resolved path, which is under root).
- **Transactions** — `createProjectWithCanvas`, `updateBrandGuidelines`, `reorderSections` all atomic. No remaining multi-statement helper that needed wrapping.
- **`workspace_settings` trust boundary** — `LLMProviderIdSchema.parse` runs on both read and write, so a row written under a future widened enum surfaces as a parse error in older code instead of corrupting downstream typing. As designed.
- **Discriminated `RealtimeAdapter`** — `main.ts` consumes via `switch (adapters.realtime.provider)` with `default: never` exhaustiveness; no `as` cast remains.
- **`LLMProviderId` single source** — declared once in `shared/llm/provider-ids.ts`, re-exported from `adapter-llm`, consumed by `server/env.ts` and `db/queries/workspace-settings.ts`. Three previous declarations collapsed.
- **Test coverage** — 103 tests across 24 files. `pnpm typecheck` / `lint` / `format:check` / `test` all green per Phase-5 completion writeup.

---

## Recommended next move

Land items 1–4 above as a small "Phase 5.1" cleanup pass — same shape as the `0.4.1` and `0.5.1` cleanups. Total touched surface ≈ 30 lines + one new test for the subscribe race. Then proceed to Phase 6 (`POST /projects/:id/agent` route + realtime fan-out) with confidence.

Items 5 and 6 stay on the deferral list — they belong to Phase 7 product/security decisions, not a pre-Phase-6 cleanup.
