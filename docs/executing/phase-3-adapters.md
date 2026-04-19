# Phase 3 Implementation Plan — Adapters: ports + default implementations

Goal: fill in the four empty `packages/adapters/*` workspaces with **ports**
(interfaces the rest of the codebase depends on) and **default
implementations** (the concrete vendors/stubs that satisfy them). Result:
the server can call `buildAdapters(env)` and get a working
`{ auth, storage, realtime, llm }` bundle, with no vendor names leaking
past the adapter boundary.

This plan expands [Phase 3 of the scaffolding plan](./scaffolding-plan.md#phase-3--adapters-ports--default-implementations)
with the design decisions made during discussion and a file-by-file task
list we can execute methodically.

---

## Locked design decisions

1. **Ports live in their adapter package, not in `shared` or a new
   `core` pkg.** Each `@brandfactory/adapter-*` exports the port type
   *and* its implementations from its root. Rationale: ports are
   server-only (the `web` package never sees them), and
   `docs/architecture.md` says "default implementations live alongside
   each port." No new workspace, no pollution of `shared`.
2. **`buildAdapters(env)` lives in `packages/server`.** The server is the
   only consumer; a wiring helper in a separate package would be dead
   weight. It reads a zod-validated env object and returns
   `{ auth, storage, realtime, llm }`.
3. **Env validation lives in `packages/server/src/env.ts`.** One zod
   schema, one `loadEnv()` call at boot, throws with a readable error on
   missing/invalid vars. Each adapter impl takes *already-validated*
   config — adapters don't read `process.env` themselves.
4. **LLM port returns an AI-SDK `LanguageModel`.** `LLMProvider.getModel({ providerId, modelId })`
   resolves to a Vercel AI SDK `LanguageModel`. Thin wrapper, no extra
   abstraction — Phase 5's `agent` package consumes AI-SDK directly, so
   any intermediate shape is pure cost. Provider packages
   (`@ai-sdk/anthropic`, `@ai-sdk/openai`, `@openrouter/ai-sdk-provider`,
   `ollama-ai-provider`) are all installed; the factory picks one at
   call time.
5. **Realtime port is pub/sub only; WS endpoint is Phase 4.**
   `RealtimeBus.publish(channel, event)` + `subscribe(channel, handler) → unsubscribe`.
   The `native-ws` adapter ships the in-process event emitter *and* a
   helper (`bindToNodeWebSocketServer`) that the server will call in
   Phase 4 when it mounts `/rt`. The adapter itself does not own the HTTP
   upgrade.
6. **Storage port surfaces signed URLs for both reads and writes.**
   `put(key, body, opts)` for server-side uploads, `getSignedReadUrl` +
   `getSignedWriteUrl` for direct browser↔storage transfer. `local-disk`
   signs with an HMAC over `(key, expiresAt, method)` using a secret
   from env; the server will expose `/blobs/:key?sig=...` routes in
   Phase 4 that verify the signature.
7. **Auth port contract: `verifyToken(token) → { userId }` +
   `getUserById(id)` + `listUsers()`.** Matches architecture.md. The
   `local` adapter treats the bearer token as a raw `user_id` (dev-only,
   no crypto) and looks it up in the `users` table. The `supabase`
   adapter verifies the JWT with the project's JWKS and returns the
   `sub` claim as `userId`.
8. **Settings source is env-only in Phase 3.** Active LLM provider +
   model are read from env (`LLM_PROVIDER`, `LLM_MODEL`, plus the
   per-provider API keys). Workspace-level persisted settings land with
   Phase 4's `/workspaces/:id/settings` route.
9. **Vitest becomes the project test runner.** Phase 3 introduces the
   first tests, so this phase also stands up vitest: one root
   `vitest.config.ts`, a `pnpm test` root script, per-package
   `*.test.ts` colocated with the source they cover.
10. **`AuthProvider` surface is `verifyToken` + `getUserById` only.**
    Drop `listUsers` from the port — listing users is a DB read, not an
    identity-provider concern, and would hide ambiguity between our
    `users` table and Supabase Auth's `auth.users`. Consumers that need
    a roster call `@brandfactory/db` directly. This diverges from
    `docs/architecture.md`'s original port sketch; architecture doc to
    be amended in the Phase 3 completion record.
11. **`local-disk` blob access is signed-URL, not middleware-gated.**
    Matches Supabase Storage's native ergonomics, keeps the port
    abstraction clean, lets `<img src>` render directly, and enables
    browser-direct uploads. Properties: HMAC-SHA256 over
    `(method, key, exp)` with a server-only `BLOB_SIGNING_SECRET`, 15-min
    default TTL, authorization happens at mint time (the mint route
    runs normal auth middleware). Leak model: a leaked URL exposes one
    blob for ≤ TTL — strictly narrower than a leaked session cookie.
    Industry-standard pattern (S3/GCS/Azure/Cloudflare/Slack/Dropbox
    all ship this).
12. **WS framing schema lives in `@brandfactory/shared`, not inline in
    the adapter.** The outer envelope (`subscribe | unsubscribe |
    event` on channels) is the protocol the browser speaks to the
    server, and `web` can't import from `adapter-realtime`. Lives at
    `packages/shared/src/realtime/envelope.ts`, exporting
    `RealtimeClientMessageSchema` (browser → server) and
    `RealtimeServerMessageSchema` (server → browser). Payloads inside
    the `event` frame are existing shared types (`AgentEvent`,
    `CanvasOpEvent`, `PinOpEvent`). The `native-ws` adapter imports
    from shared; a future Supabase Realtime adapter would internally
    translate to/from Supabase's wire format while keeping this
    envelope as the frontend-facing protocol.
13. **Per-provider config is discrete env vars, not a JSON blob.**
    Twelve-factor convention, plays well with every hosting platform's
    secret management, `*_API_KEY` patterns are recognized by secret
    scanners, keeps `.env.example` self-documenting. Most importantly,
    composes cleanly with the workspace-level settings that arrive in
    Phase 4 — flat env maps to flat DB rows; an env blob would push us
    toward a DB blob that resists per-field overrides. Conditional
    validation (e.g. "if `LLM_PROVIDER=anthropic` then
    `ANTHROPIC_API_KEY` is required") done with `zod.superRefine` in
    the env schema.
14. **Vitest runs in projects mode, one root `vitest.config.ts`.**
    Each workspace is declared as a project; cross-package watch mode
    works out of the box; shared setup/reporter/coverage config lives
    in one place and doesn't drift. Package-specific needs (e.g.
    `jsdom` for `web` once it ships) are handled by per-package
    `vitest.config.ts` files that the root config references.
    Single `pnpm test` at the root is the canonical entry point; per-
    package scripts exist but delegate to the root runner so `pnpm
    --filter @brandfactory/<pkg> test` still works.
15. **Deferred adapter impls are absent from code, not throw-stubs.**
    The realtime package ships `createNativeWsRealtimeBus` only.
    `REALTIME_PROVIDER`'s zod enum is narrowed to `'native-ws'`, so a
    misconfigured env fails loudly at boot rather than dormantly at
    first realtime event. When a future impl (Supabase Realtime, Ably,
    etc.) lands, widen the enum + add the factory + add the switch
    branch — the compiler enforces exhaustiveness. To preserve
    future-intent without introducing a runtime landmine, each adapter
    package carries a short header comment in `src/index.ts` listing
    planned-but-not-yet-shipped impls (e.g. `// Future impls: supabase
    realtime`). Same convention applied symmetrically across all four
    adapter packages (auth → OIDC; storage → S3; realtime → supabase;
    llm → mistral / google / etc.). Header comments are *documentation
    only*, no code stubs.

---

## Prerequisite: shared gains a `realtime/envelope.ts`

Per locked decision 12, the WS framing schema lives in
`@brandfactory/shared`. Add before touching the adapter package:

- [ ] `packages/shared/src/realtime/envelope.ts`:
  - `RealtimeChannelSchema = z.string().min(1)` (tighten later when we
    settle on a channel-naming convention).
  - `RealtimeEventPayloadSchema = z.union([AgentEventSchema, CanvasOpEventSchema, PinOpEventSchema])`.
  - `RealtimeClientMessageSchema` — browser → server:
    `discriminatedUnion('type', [
       { type: 'subscribe',   channel },
       { type: 'unsubscribe', channel }
     ])`.
  - `RealtimeServerMessageSchema` — server → browser:
    `{ type: 'event', channel, payload: RealtimeEventPayloadSchema }`.
  - Inferred types exported alongside the schemas.
- [ ] `packages/shared/src/index.ts`: barrel re-export.
- [ ] Verify: `pnpm --filter @brandfactory/shared typecheck`, repo-wide
  `lint` and `format:check`.

No other shared changes are needed for Phase 3. Ports are TypeScript
interfaces, not zod schemas, and the agent event types already exist.

---

## Implementation tasks

### 1. Shared port conventions

Before writing the first adapter, lock three tiny conventions so the
four packages look alike:

- Each adapter package's `src/index.ts`:
  - Opens with a short header comment listing shipped impls and
    planned-but-not-yet-shipped ones (per locked decision 15).
  - Exports the **port type** (e.g. `AuthProvider`).
  - Exports each **implementation** as a factory function
    (e.g. `createLocalAuthProvider(deps)`, `createSupabaseAuthProvider(config)`).
  - Exports a **config type** per implementation where relevant.
- Implementations are factories, not classes. Plain objects satisfying
  the port interface. Keeps DI explicit and testing trivial.
- All async surface returns `Promise<T>`; no callbacks.
- Errors thrown from adapters are plain `Error` subclasses for now.
  Error taxonomy is Phase 9.

### 2. `@brandfactory/adapter-auth`

- [ ] `package.json`:
  - runtime deps: `@brandfactory/db` (for the `local` adapter's user
    lookup), `jose` (JWT verify for supabase).
  - dev deps: `vitest`, `@types/node`.
- [ ] `src/port.ts`:
  - `AuthProvider` interface: `verifyToken(token: string): Promise<{ userId: string }>`,
    `getUserById(id: string): Promise<User | null>`.
  - Re-export `User` from `@brandfactory/db` so callers get one canonical
    row type.
  - **No `listUsers`.** Listing users is a DB read (Postgres rows), not
    an identity-provider concern — consumers should call a query helper
    in `@brandfactory/db` directly. Putting it on the port would hide
    ambiguity between "our `users` table" and "Supabase Auth's
    `auth.users`" behind one method name.
- [ ] `src/local.ts`:
  - `createLocalAuthProvider({ db }): AuthProvider`.
  - `verifyToken(token)` treats `token` as a `user_id` (uuid). Throws
    `InvalidTokenError` if not a uuid, or if the user doesn't exist.
  - `getUserById` delegates to `@brandfactory/db`'s `getUserById` query.
- [ ] `src/supabase.ts`:
  - `createSupabaseAuthProvider({ jwksUrl, audience, db }): AuthProvider`.
  - Uses `jose.createRemoteJWKSet` + `jose.jwtVerify` to validate
    Supabase's signed JWT. Extracts `sub` → `userId`.
  - `getUserById` still hits `@brandfactory/db` — Phase 3 does not sync
    Supabase Auth's user table back into ours; that's a Phase 4 or
    later concern.
- [ ] `src/local.test.ts` — fixtures: a real Postgres via the existing
  docker compose, insert a user, verify round-trip. Skipped if
  `DATABASE_URL` unset, so CI can run without docker.
- [ ] `src/supabase.test.ts` — fixture: mock a JWKS endpoint via a tiny
  in-test HTTP server (no real Supabase). Verify a valid token decodes,
  an expired one rejects.
- [ ] `src/index.ts`: barrel.

### 3. `@brandfactory/adapter-storage`

- [ ] `package.json`:
  - runtime deps: `@supabase/supabase-js` (for the supabase adapter).
  - `node:crypto` + `node:fs/promises` + `node:path` for local-disk (no
    deps needed).
  - dev deps: `vitest`.
- [ ] `src/port.ts`:
  - `BlobStore` interface:
    - `put(key, body: Uint8Array | NodeJS.ReadableStream, opts: { contentType?: string }): Promise<void>`
    - `get(key): Promise<Uint8Array>`
    - `delete(key): Promise<void>`
    - `getSignedReadUrl(key, { ttlSeconds }): Promise<string>`
    - `getSignedWriteUrl(key, { ttlSeconds, contentType?: string }): Promise<{ url: string; headers?: Record<string, string> }>`
- [ ] `src/local-disk.ts`:
  - `createLocalDiskBlobStore({ rootDir, signingSecret, publicBaseUrl }): BlobStore`.
  - `put` writes under `rootDir/<key>`; `get` reads; `delete` unlinks.
  - `getSignedReadUrl(key, { ttlSeconds })` returns
    `${publicBaseUrl}/${key}?exp=<unix>&sig=<hmac>`. HMAC-SHA256 over
    `${method}\n${key}\n${exp}` with `signingSecret`.
  - `getSignedWriteUrl` same, method `PUT`. The verifying HTTP handler
    lives in `packages/server` (Phase 4).
  - Export a helper `verifySignature({ method, key, exp, sig, signingSecret })`
    so the server can reuse the same check.
- [ ] `src/supabase.ts`:
  - `createSupabaseBlobStore({ url, serviceKey, bucket }): BlobStore`.
  - Thin wrapper over `createClient(url, serviceKey).storage.from(bucket)`:
    `upload`, `download`, `remove`, `createSignedUrl`, `createSignedUploadUrl`.
- [ ] `src/local-disk.test.ts` — tmpdir fixture, put/get/delete,
  sign/verify roundtrip, expired signature rejection.
- [ ] `src/supabase.test.ts` — skipped unless `SUPABASE_URL` +
  `SUPABASE_SERVICE_KEY` present. CI default: skip.
- [ ] `src/index.ts`: barrel.

### 4. `@brandfactory/adapter-realtime`

- [ ] `package.json`:
  - runtime deps: `ws` (for `bindToNodeWebSocketServer`).
  - dev deps: `vitest`, `@types/ws`.
- [ ] `src/port.ts`:
  - `RealtimeBus` interface:
    - `publish(channel: string, event: AgentEvent | CanvasOpEvent | PinOpEvent): Promise<void>`
    - `subscribe(channel: string, handler: (event) => void): () => void` (returns unsubscribe).
  - Event type is imported from `@brandfactory/shared`.
- [ ] `src/native-ws.ts`:
  - `createNativeWsRealtimeBus(): RealtimeBus & { bindToNodeWebSocketServer(wss, { authenticate }): void }`.
  - In-process pub/sub via a `Map<channel, Set<handler>>`.
  - `bindToNodeWebSocketServer` takes a `ws.Server` and an
    `authenticate(req) → userId` callback, wires up `connection` →
    per-client `subscribe` messages → fan-out from the bus.
  - Message framing: JSON, `{ type: 'subscribe' | 'unsubscribe' | 'event', channel, payload? }`.
    Validated against a zod schema declared inline here.
- [ ] *(no `src/supabase.ts` in Phase 3.)* Per locked decision 15,
  deferred impls are absent from code, not throw-stubs. Future intent
  recorded in `src/index.ts`'s header comment only.
- [ ] `src/native-ws.test.ts` — spin up a real `ws.Server` on an
  ephemeral port, connect two clients, verify fan-out ordering and
  unsubscribe.
- [ ] `src/index.ts`: barrel.

### 5. `@brandfactory/adapter-llm`

- [ ] `package.json`:
  - runtime deps: `ai` (just the core — provider packages ship the
    model factories), `@ai-sdk/anthropic`, `@ai-sdk/openai`,
    `@openrouter/ai-sdk-provider`, `ollama-ai-provider`.
  - dev deps: `vitest`.
- [ ] `src/port.ts`:
  - `LLMProvider` interface:
    - `getModel(settings: { providerId: LLMProviderId; modelId: string }): LanguageModel`.
  - `LLMProviderId = 'openrouter' | 'anthropic' | 'openai' | 'ollama'`.
  - `LanguageModel` is the AI-SDK core type — `import type { LanguageModel } from 'ai'`.
- [ ] `src/factory.ts`:
  - `createLLMProvider(config: LLMProviderConfig): LLMProvider`.
  - `LLMProviderConfig`:
    ```
    {
      openrouter?: { apiKey: string; baseURL?: string };
      anthropic?:  { apiKey: string };
      openai?:     { apiKey: string };
      ollama?:     { baseURL?: string };
    }
    ```
  - Factory switches on `providerId`, builds the corresponding SDK
    provider lazily on first call, caches per provider. Throws
    `ProviderNotConfiguredError` if the caller asks for a provider whose
    config is missing.
- [ ] `src/factory.test.ts` — unit tests with stubbed provider modules
  via `vi.mock`. Verify correct SDK call, config passing, error path for
  missing config.
- [ ] `src/index.ts`: barrel (`LLMProvider`, `LLMProviderId`,
  `LLMProviderConfig`, `createLLMProvider`, `ProviderNotConfiguredError`).

### 6. Server env loader + `buildAdapters`

Lives in `packages/server` but is scoped here because Phase 3's smoke
depends on it.

- [ ] `packages/server/package.json`:
  - runtime deps: the four adapter packages, `zod`, `dotenv`.
  - dev deps: `vitest`, `tsx`.
- [ ] `packages/server/src/env.ts`:
  - `EnvSchema` (zod): `AUTH_PROVIDER: 'local' | 'supabase'`,
    `STORAGE_PROVIDER: 'local-disk' | 'supabase'`,
    `REALTIME_PROVIDER: 'native-ws' | 'supabase'`,
    `LLM_PROVIDER: LLMProviderId`, `LLM_MODEL`, `DATABASE_URL`, plus
    conditional fields per provider (e.g. `SUPABASE_URL` required when
    `AUTH_PROVIDER === 'supabase'`, enforced via `.superRefine`).
  - `loadEnv(): Env` reads `process.env`, runs `.parse`, throws with a
    pretty message on failure.
- [ ] `packages/server/src/adapters.ts`:
  - `buildAdapters(env: Env): { auth: AuthProvider; storage: BlobStore; realtime: RealtimeBus; llm: LLMProvider }`.
  - Switches on each `*_PROVIDER` value, calls the matching factory with
    the right slice of env.
- [ ] `packages/server/src/env.test.ts` — happy path per provider combo,
  error path for missing required var.
- [ ] `packages/server/src/adapters.test.ts` — smoke: build with
  `AUTH_PROVIDER=local STORAGE_PROVIDER=local-disk REALTIME_PROVIDER=native-ws LLM_PROVIDER=openrouter`
  and assert the returned bundle has the four expected methods.

### 7. Root vitest setup

- [ ] Install `vitest` at the root as a dev dep.
- [ ] Root `vitest.config.ts`: projects mode, pointing at each package.
  Single `pnpm test` script at the root runs them all.
- [ ] Per-package `vitest.config.ts` minimal (or omit and inherit from
  root if projects mode is configured).
- [ ] CI env default: tests that need `DATABASE_URL` / `SUPABASE_*`
  guard with `it.skipIf(!process.env.DATABASE_URL)` rather than failing.

### 8. Env examples

- [ ] Extend repo-root `.env.example` with the new vars, grouped by
  provider choice. Include a comment header explaining
  `*_PROVIDER` = "which adapter the server will wire up".
- [ ] Also document `BLOB_LOCAL_DISK_ROOT`, `BLOB_SIGNING_SECRET`,
  `BLOB_PUBLIC_BASE_URL` (local-disk), `SUPABASE_URL`,
  `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`,
  `SUPABASE_JWT_AUDIENCE` (supabase), the four LLM API keys.

### 9. Smoke check

Per the scaffolding plan, Phase 3's smoke is **unit tests per adapter**,
not an end-to-end. Concretely:

- [ ] `pnpm test` green at the repo root — every adapter's own tests
  pass (auth/local against a docker Postgres, auth/supabase against a
  mock JWKS, storage/local-disk against a tmpdir, realtime/native-ws
  over real `ws`, llm/factory with mocked SDK providers).
- [ ] `pnpm --filter @brandfactory/server test` green —
  `env.test.ts` + `adapters.test.ts` pass.
- [ ] Repo-wide `pnpm lint`, `pnpm typecheck`, `pnpm format:check` all
  green.

---

## What Phase 3 explicitly does NOT include

- **HTTP server / routes / middleware.** Phase 4.
- **WebSocket upgrade endpoint `/rt`.** Phase 4 (uses Phase 3's
  `bindToNodeWebSocketServer`).
- **Blob HTTP routes** that verify signed URLs. Phase 4 (uses Phase 3's
  `verifySignature` helper).
- **Workspace-level LLM settings persisted in DB.** Env-only here; the
  `/settings` route lives in Phase 4.
- **Agent prompt assembly / streaming / tool handlers.** Phase 5.
- **Sync between Supabase Auth users and our `users` table.** Later.
- **API-key encryption at rest.** When DB-persisted settings land.
- **Full e2e / Playwright.** Phase 9.

---

## Open questions (with leanings)

*(All open questions have been resolved and promoted to locked
decisions above.)*

---

## Phase 3 completion record

On completion, document actuals in `docs/completions/phase3.md` and
per-task records `phase3-task1.md` through `phase3-task9.md` in the same
style as Phase 2. Capture: locked decisions as delivered, how each open
question landed, any adapter-level API notes (AI-SDK quirks, Supabase
JWKS, HMAC signing format), and the unit-test output.

Archive this file to `docs/archive/phase-3-adapters.md` once the record
is written.
