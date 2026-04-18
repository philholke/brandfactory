Below is a Brand Wiki Blueprint, outlining how we've previously designed Brand Wikis / Knowledge Bases in another application of ours.

This is just a reference document for inspiration/reference while we're designing our own/proprietary BrandFactory model here.

In future, we'll want to be able to get Launchpad integrated - possibly two-ways i.e. allowing users of Launchpad to link up and import Brands and their associated Wikis/Knowledge Bases into BrandFactory, as well as vice versa: creating brands in BrandFactory and pushing them into Launchpad.

--


# Brand Wiki Blueprint

> **Feature area:** Structured brand knowledge capture + Socratic AI interview agent
> **Primary packages:** `@launchpad/server`, `@launchpad/shared`, `@launchpad/web`
> **Audience:** Senior engineers joining Launchpad, *and* teams replicating the pattern in a different product domain. Where the design is domain-agnostic, that's flagged explicitly — the same shape re-skins cleanly from "brand knowledge" to any taxonomy of structured, floor-gated, human-in-the-loop content.

---

## Conceptual Overview

Every brand carries a body of knowledge — positioning, voice, visual language, service rituals, menu philosophy — that lives, in most companies, across scattered decks, founder emails, a handful of Notion pages, and a lot of institutional memory. The Brand Wiki is our attempt to make that knowledge **first-class, structured, and machine-readable**, so downstream tooling (content agents, campaign briefs, voice-check pipelines, future team-training material) can consume it as a reliable contract rather than scraping it out of prose. It is, simultaneously, a human-readable reference: each brand has a wiki home with nine bucket-shaped pages, and each outlet can override selected sub-buckets without forking the whole record.

The central design bet is that good brand knowledge cannot be collected with a form. Forms produce shallow, obvious, un-opinionated output — the fields that are easy to fill in get filled, the hard ones get "we'll come back to this later". So the Brand Wiki is paired with a **Socratic interview agent**: an LLM-driven chat that walks one admin through one bucket at a time, probing for specificity, testing the negative, surfacing contradictions, and refusing to let the conversation drift. The agent can only write to a draft via typed tool calls, it's fenced inside a single bucket at three separate layers (route, prompt, tool), and it cannot commit anything until the draft clears both a structural floor (Zod) and a semantic floor (a final exam where the agent writes fresh usage examples and the human grades them pass/fail).

Architecturally the feature is organised around **nine buckets grouped into four jsonb columns** — four on `brands`, four nullable mirrors on `outlets` for overrides. Each bucket has a V1 Zod schema in the shared package that encodes both shape and quality floors (e.g. "voice & tone requires at least three dos and three don'ts"), and those schemas are the single source of truth: they are invoked at every write path (admin CRUD, interview commit) and define what a valid bucket looks like everywhere from the API boundary to the read UI. Each bucket that has an interview agent is a **plugin** — a single `BucketConfig` file registers its tools, prompts, floor logic, exam prompt, and commit adapter, and the interview loop itself contains zero bucket-specific code. Adding a tenth bucket is a config file, a UI component, and a Zod schema; the loop, session store, and commit path stay untouched.

The read path is deliberately the reverse of the capture path: generic and registry-driven. A single dispatcher page looks up bucket metadata from a registry, fetches either the brand record or the server-merged brand+outlet record (with a `sources` provenance map so outlet overrides can be badged), and hands the payload to a per-bucket view component. There is no merge logic in the frontend, no LLM on the read path, and no second write channel. Admin CRUD and interview-commit both converge on the same Zod-gated service-layer setter, which is the only thing in the system that can modify a jsonb column — meaning the same validation rules apply regardless of whether a human wrote the payload directly or extracted it from a conversation with the agent.

---

## 1. What It Is

The Brand Wiki is the canonical store of "what is this brand" knowledge for every brand in the portfolio (Temper, Casa Vostra, …). It replaces ad-hoc decks, Notion pages, and founder memory with a **typed, Zod-gated, jsonb-backed knowledge base** that downstream agents (content generation, campaign briefs, voice-check tooling) can reliably consume.

It has two halves:

1. **The wiki** — storage, read UI, and admin CRUD for structured brand knowledge organised across 9 buckets.
2. **The interview agent** — a Socratic LLM-driven session that walks a human admin through a single bucket, writes into a draft via tool calls, enforces quality floors, final-exams the output, and commits to the wiki.

The interview agent exists because raw JSON forms produced low-quality, shallow inputs. Getting *genuinely useful* brand knowledge out of humans needs a probing, anti-flattery, contradiction-hunting conversation. That conversation is the agent.

### Why replicate this pattern

The architecture generalises to any product that needs to:

- Capture structured knowledge from humans with enforceable quality floors.
- Keep knowledge **versioned by schema** so downstream consumers can rely on a contract.
- Offer **overlay / override** semantics (e.g. per-tenant, per-region, per-outlet) without duplicating the base record.
- Let an LLM drive the capture interview but never let it write to storage directly — every commit passes through a deterministic Zod gate.

Examples outside F&B: SOP libraries, product-spec registries, compliance policy packs, candidate briefs, customer ICP profiles, tenant configuration wizards.

---

## 2. High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         READ PATH (any user)                         │
│                                                                      │
│   Wiki UI  ──▶  GET /api/brands/:id/knowledge       ──▶  service    │
│                  GET /api/outlets/:id/knowledge/merged ──▶  merge    │
│                                                           (shared)  │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│                    WRITE PATH (admin only)                           │
│                                                                      │
│   Admin CRUD  ──▶  PATCH /api/brands/:id/knowledge/:column           │
│                       │                                              │
│                       ▼                                              │
│             Zod gate (zCoreV1 / zVisualV1 / …)                       │
│                       │                                              │
│                       ▼                                              │
│                  UPDATE brands SET …                                 │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│                    INTERVIEW PATH (admin only)                       │
│                                                                      │
│   Chat UI ──▶ POST /api/brand-interview                              │
│                 └─▶ session store (in-memory, 2h TTL)                │
│           ──▶ POST /…/turns          ──▶ OpenRouter LLM              │
│                                            │                         │
│                                       tool-calls                     │
│                                            ▼                         │
│                            BucketConfig.applyToolCall(draft)         │
│                                            │                         │
│                            floor check  ◀──┘                         │
│           ──▶ POST /…/final-exam     ──▶ LLM generates 3–6 examples │
│           ──▶ POST /…/grades         ──▶ human marks pass/fail       │
│           ──▶ POST /…/commit         ──▶ finaliseDraft → setter →    │
│                                              Zod gate → UPDATE       │
└──────────────────────────────────────────────────────────────────────┘
```

Three paths, one store. The interview path is the *only* path that ever carries free-form LLM output, and it converges on the exact same Zod-gated setter as the admin CRUD path. There is no second write channel.

---

## 3. Data Model

### 3.1 Storage — four jsonb columns, two tables

The wiki is stored as **four nullable jsonb columns** on `brands`, mirrored on `outlets` for overrides. No dedicated wiki tables, no joins.

```sql
-- migration 0035 (brands)
ALTER TABLE brands ADD COLUMN core_brand_knowledge        jsonb;
ALTER TABLE brands ADD COLUMN visual_brand_knowledge      jsonb;
ALTER TABLE brands ADD COLUMN operational_brand_knowledge jsonb;
ALTER TABLE brands ADD COLUMN extended_brand_knowledge    jsonb;

-- migration 0036 (outlets — same four columns, nullable overrides)
ALTER TABLE outlets ADD COLUMN core_brand_knowledge        jsonb;
ALTER TABLE outlets ADD COLUMN visual_brand_knowledge      jsonb;
ALTER TABLE outlets ADD COLUMN operational_brand_knowledge jsonb;
ALTER TABLE outlets ADD COLUMN extended_brand_knowledge    jsonb;
```

Schema definition: `packages/server/src/db/schema.ts` (lines 31–70).

Why four columns and not one jsonb blob? Each column maps to a **column-level Zod schema** that's independently validated and independently setable. `PATCH /knowledge/:column` writes one column at a time; a broken identity payload cannot corrupt visual knowledge.

Why jsonb and not relational tables? The sub-bucket shape churns faster than the schema tool can keep up with, the data is always read as a whole document (never by sub-row), and we want `schemaVersion` to be part of the payload so consumers can branch on version when we cut V2. jsonb + Zod is the right trade.

### 3.2 The nine buckets

Buckets are grouped into the four columns:

| Column | Bucket | Purpose |
|---|---|---|
| `core` | `identity` | One-liner, positioning, elevator pitch, founding story |
| `core` | `voiceAndTone` | Dos, don'ts, forbidden phrases, signature moves, channel variants |
| `core` | `targetMarket` | Personas, occasions, mindsets, alternatives |
| `core` | `competitive` | Adjacent brands, anti-positioning, territory owned |
| `visual` | `visualIdentity` | Logos, colours, typography, imagery |
| `visual` | `spaceAtmosphere` | Interior, lighting, music, pacing |
| `operational` | `menuPhilosophy` | Cuisine positioning, signatures, pricing, absences |
| `operational` | `serviceStandards` | Service personality, signature moments, non-negotiables |
| `extended` | `extras` | Free-form labelled sections (history, awards, press) |

Core buckets are the ones most useful to content-generating agents; they are the priority for every new brand. Operational buckets are F&B-specific *as data* but the shape (philosophy + standards) is portable to any operations-heavy domain.

### 3.3 Zod schemas and floor rules

Every bucket has a V1 Zod schema in `packages/shared/src/brand-knowledge/` (`core.v1.ts`, `visual.v1.ts`, `operational.v1.ts`, `extended.v1.ts`). All bucket shapes extend `zTldrSlot` (optional 120-char `tldr` for scannable summaries).

**Floors** are minimum-viable-content rules, enforced inside the Zod schema itself. Examples:

```ts
// voiceAndTone — ≥3 dos and ≥3 don'ts
export const zVoiceAndToneV1 = zTldrSlot.extend({
  dos:   z.array(zToneRuleV1).min(3, 'voiceAndTone floor: at least 3 dos are required'),
  donts: z.array(zToneRuleV1).min(3, "voiceAndTone floor: at least 3 don'ts are required"),
  forbiddenPhrases: z.array(z.string().min(1).max(200)).default([]),
  signatureMoves:   z.array(z.string().min(1).max(500)).default([]),
  channelVariants:  z.array(zChannelVariantV1).default([]),
});
```

```ts
// visualIdentity — primary colour is mandatory when colours is set
export const zVisualIdentityV1 = zTldrSlot.extend({
  logos: z.array(zLogoRefV1).default([]),
  colours: z.object({
    primary: zHexColour,                       // required
    secondary: z.array(zHexColour).default([]),
    accents: z.array(zHexColour).default([]),
    neutrals: z.array(zHexColour).default([]),
  }).optional(),
  typography: …,
  imagery: …,
});
```

**Floor semantics.** Floors apply *only when a sub-bucket is present.* A brand with just `identity` populated passes validation — the other sub-buckets being undefined is legal. This is the **independent-completeness** principle: a brand is not forced to answer everything before anything is saved. Each bucket is a standalone commit.

### 3.4 Outlet overrides (Phase 4 — migration 0036)

Outlets store the same four jsonb columns. On read, the server **merges outlet over brand at the sub-bucket level** and returns a source map so the UI can show badges.

Merge rules (`packages/shared/src/brand-knowledge/merge.ts`):

- If an outlet sub-bucket is set (non-null, non-undefined), it **fully replaces** the brand's sub-bucket. There is no deep merge inside a sub-bucket — either the outlet tells the whole story for that sub-bucket, or it defers.
- `extended.sections` is the exception: it merges by `id`; matching ids are overridden, non-matching outlet entries are appended.
- Return shape: `{ brand, outlet, merged, sources }` where `sources` maps each sub-bucket to `'brand' | 'outlet' | 'merged' | 'none'`.

This pattern is the one most likely to be useful outside F&B — replace "brand / outlet" with "tenant / sub-tenant", "org / team", "product / SKU". The shape is the same: a parent document, a child document that overrides sub-keys, a merged read with provenance.

---

## 4. Bucket Config Registry — the plugin pattern

Every bucket that has an interview agent is a **plugin**, configured in exactly one file. Adding a tenth bucket is one config file + one UI component + zero changes to the interview loop.

### 4.1 `BucketConfig` shape

```ts
// packages/server/src/services/brand-interview/buckets/types.ts
export interface BucketConfig {
  // Identity
  key: string;                              // 'identity', 'voiceAndTone', …
  column: 'core' | 'visual' | 'operational' | 'extended';
  subKey: string;                           // key in the column document
  label: string;                            // human-facing

  // LLM surface
  tools: ToolDefinition[];                  // OpenAI-compatible function schemas
  applyToolCall: (draft, name, rawArgs) => ToolCallResult;

  // Prompts
  systemPrompt: string;                     // contains {BRAND_LABEL} placeholder
  opener: (brandLabel: string) => string;   // first assistant message

  // Floor & finalisation
  checkFloor: (draft) => FloorResult;       // { met, missing[], progress }
  finaliseDraft: (draft) => unknown;        // Zod-validate, return shape

  // Final exam
  examPrompt: string;
  summariseDraft: (draft) => string;
  fallbackExamples: (brandLabel) => FinalExamExample[];
}
```

### 4.2 Registry

```ts
// packages/server/src/services/brand-interview/buckets/index.ts
const BUCKET_CONFIGS = new Map<string, BucketConfig>([
  [identityConfig.key, identityConfig],
  [voiceAndToneConfig.key, voiceAndToneConfig],
  [targetMarketConfig.key, targetMarketConfig],
  [competitiveConfig.key, competitiveConfig],
  [visualIdentityConfig.key, visualIdentityConfig],
  [spaceAtmosphereConfig.key, spaceAtmosphereConfig],
  [menuPhilosophyConfig.key, menuPhilosophyConfig],
  [serviceStandardsConfig.key, serviceStandardsConfig],
  [extrasConfig.key, extrasConfig],
]);

export function getBucketConfig(key: string): BucketConfig | null {
  return BUCKET_CONFIGS.get(key) ?? null;
}
```

The interview loop does **nothing** bucket-specific. Every per-bucket decision — which tools exist, what floor means, how to summarise for the exam, how to opening-message — is data inside the config object.

### 4.3 A bucket config in full

```ts
// identity.ts (elided to ~15 lines)
export const identityConfig: BucketConfig = {
  key: 'identity',
  column: 'core',
  subKey: 'identity',
  label: 'Identity',
  tools,                  // set_one_liner, set_positioning, set_elevator_pitch,
                          // set_founding_story, set_tldr, mark_bucket_ready
  applyToolCall,          // dispatch + arg-validation
  systemPrompt,           // ~220 lines of Socratic instructions
  opener,                 // "Working on identity for {brand}. If you had to say…"
  checkFloor,             // met when oneLiner present; progress 0..1
  finaliseDraft,          // zIdentityV1.parse — throws if floor fails
  examPrompt,
  summariseDraft,
  fallbackExamples,
};
```

### 4.4 Tool definition — OpenAI function-calling format

```ts
{
  type: 'function',
  function: {
    name: 'set_one_liner',
    description:
      'Record the one-sentence description of the brand. Must be 1-280 characters. ' +
      'Call again to overwrite.',
    parameters: {
      type: 'object',
      properties: {
        oneLiner: { type: 'string', description: 'One-sentence brand description.' },
      },
      required: ['oneLiner'],
    },
  },
}
```

Each bucket exposes 5–8 tools — setters for every floor-relevant field, optional `set_tldr`, and always a terminal `mark_bucket_ready` that signals "I believe the floor is met, advance the session". Unknown tool names fail with `{ ok: false, error: 'unknown tool: X' }` — the LLM cannot invent fields.

---

## 5. The Interview Agent

### 5.1 Session store

```ts
// packages/server/src/services/brand-interview/session.ts
export interface InterviewSession {
  id: string;
  brandId: string;
  brandLabel: string;
  bucket: string;
  stage: 'discovery' | 'final-exam' | 'reopened' | 'awaiting-approval'
       | 'committed'  | 'abandoned';
  messages: InterviewMessage[];     // full LLM transcript incl. tool calls
  draft: BucketDraft;               // mutated in place by tool calls
  currentExam: FinalExamExample[];
  reopenCount: number;
  createdAt: number;
  lastActiveAt: number;
  events: Array<{ at: number; kind: string; detail?: string }>;
}
```

**In-memory, per-process, 2-hour idle TTL, hard ceiling 500 sessions.** This is a deliberate simplification: no Redis, no serialisation, no cross-node coordination. Sessions are ephemeral — the *commit* is durable, the conversation is not. On server restart, any in-flight session is lost; the human restarts the interview. Committed brand knowledge is never at risk because it is already in the database.

If you port this to a multi-node deployment, either pin interview traffic to a single node (sticky sessions), move the store to Redis with a serialisable session shape, or accept the restart caveat as we do.

### 5.2 Turn loop

Each `POST /:id/turns` turn:

1. Append the user message to `session.messages`.
2. Inject a system-role **progress meta message** into the LLM's context:
   ```
   [session-progress] bucket=identity floor_met=false
   missing=one-liner (required), positioning (strongly encouraged)
   progress=25% stage=discovery reopen_count=0
   ```
   This lets the agent adapt its questioning in real time without the human repeating themselves.
3. Call OpenRouter with `messages + tools = config.tools`.
4. For each `tool_call` in the response:
   - Run `config.applyToolCall(draft, name, rawArgs)`.
   - Append a `tool`-role message with the result.
   - Mutate `session.draft`.
5. Re-evaluate `config.checkFloor(draft)`. Record events when floor flips from unmet → met.
6. If the assistant called `mark_bucket_ready` and the floor is met, advance stage to `final-exam`.

### 5.3 The three-layer scope fence

The interview is **one bucket at a time, one brand at a time**. Drift is prevented at three layers:

1. **Route fence** — `SUPPORTED_BUCKETS` set in `routes/brand-interview.ts` rejects sessions for unknown keys.
2. **Prompt fence** — each bucket's `systemPrompt` names the bucket explicitly and instructs the agent to redirect politely if the human pivots to a different bucket.
3. **Tool fence** — only the bucket's registered tools are sent to the LLM. If the agent hallucinates a tool name (e.g. calls `set_logo` during an identity interview), dispatch returns `{ ok: false, error: 'unknown tool' }` and the draft is unchanged.

Three independent layers. A failure in one (a prompt the LLM ignores) is caught by the next.

### 5.4 Floor check

```ts
// identity.ts checkFloor, elided
function checkFloor(draft: IdentityDraft): FloorResult {
  const missing: string[] = [];
  if (!draft.oneLiner)     missing.push('one-liner (required)');
  if (!draft.positioning)  missing.push('positioning (strongly encouraged)');
  // …
  const met = !!draft.oneLiner;                    // hard floor
  const progress = fieldsFilled(draft) / totalFields;
  return { met, missing, progress };
}
```

**Required** fields gate `met`. **Encouraged** fields don't gate `met` but show in `missing` so the agent knows to probe. Both are surfaced to the LLM each turn via the progress meta message.

### 5.5 Final-exam gate — the "hardening"

The floor says "you've filled the required slots". It says nothing about whether those slots, in combination, produce usable brand knowledge. The final exam tests that.

When `mark_bucket_ready` fires and floor is met:

1. `generateFinalExam(session)` calls the LLM with `config.examPrompt` and `config.summariseDraft(draft)` as context. Returns 3–6 fresh usage examples — the agent writes a campaign email, an Instagram caption, a server spiel, etc., **based on the draft**.
2. The human grades each example `pass` or `fail`, optionally with a correction note.
3. `evaluateExamGrades(session.currentExam)`:
   - All pass → stage advances to `awaiting-approval`.
   - Any fail → append a system message summarising the corrections, reset stage to `reopened`, re-enter discovery with context.
4. `session.reopenCount` is tracked for telemetry. There's no hard cap — the interview runs until the human is satisfied or abandons.

Why this matters: Zod floors catch *structural* incompleteness. The exam catches *semantic* incompleteness. A brand can have three `dos` and three `don'ts` that pass Zod but produce bland, off-brand output — the exam surfaces that before commit.

### 5.6 Commit path

`POST /:id/commit { editedDraft }`:

1. `config.finaliseDraft(editedDraft)` — re-validates against the full V1 Zod schema. Throws `AppError(400, …)` if the human's edits broke the floor.
2. Call the matching setter (`setCoreBrandKnowledge(brandId, { …existing, [subKey]: finalised })`) — the setter re-validates the whole column before writing.
3. `UPDATE brands SET {column} = …`.
4. Mark session `committed`.

**The LLM never writes to the database.** The draft lives in memory, validated at the commit boundary by the same setter that admin CRUD uses. Interview output and admin output are indistinguishable on read.

### 5.7 LLM provider

OpenRouter, OpenAI-compatible chat completions, default model `anthropic/claude-sonnet-4-6` (overridable via `AI_MODEL` env var). Error mapping (`openrouter.ts`):

| OpenRouter | AppError |
|---|---|
| 401 / 404 (key invalid, model missing) | 502 |
| 402 / 429 | 429 |
| 5xx | 502 |
| Timeout | 504 |
| Missing `OPENROUTER_API_KEY` | 503 |

All errors surface human-readable messages to the admin UI.

---

## 6. Routes, Services, Validation Gates

### 6.1 HTTP surface

```
# Wiki — read/write knowledge directly
GET   /api/brands/:id/knowledge                 any authed user
PATCH /api/brands/:id/knowledge/:column         requireAdmin
GET   /api/outlets/:id/knowledge/merged         any authed user
PATCH /api/outlets/:id/knowledge/:column        requireAdmin

# Interview — Socratic capture flow (all POST are requireAdmin)
POST  /api/brand-interview                      start session
GET   /api/brand-interview/:sessionId           snapshot for UI
POST  /api/brand-interview/:sessionId/turns     user message → LLM turn
POST  /api/brand-interview/:sessionId/final-exam generate 3–6 examples
POST  /api/brand-interview/:sessionId/grades    submit pass/fail
POST  /api/brand-interview/:sessionId/commit    finalise + write draft
POST  /api/brand-interview/:sessionId/abandon   discard session
```

All routes sit behind the global auth + RLS middleware (see `auth-and-security-blueprint.md`). Write routes additionally require admin.

### 6.2 Service layer

One service per column:

```ts
// packages/server/src/services/brand-knowledge.ts
export async function setCoreBrandKnowledge(brandId: string, payload: unknown) {
  await ensureBrandExists(brandId);
  const result = zCoreBrandKnowledgeV1.safeParse(payload);
  if (!result.success) {
    throw new AppError(400, zodIssuesToMessage(result.error));
  }
  await db.update(brands)
    .set({ coreBrandKnowledge: result.data, updatedAt: new Date() })
    .where(eq(brands.id, brandId));
  return result.data;
}
```

Zod errors are formatted as `path: message; path: message; …` so the client renders actionable field-level feedback.

### 6.3 Double Zod gate

Writes pass Zod twice:

1. **Route layer** — `validate(startSchema)` middleware parses the request envelope (brandId, brandLabel, bucket key).
2. **Service layer** — the setter calls the bucket's V1 schema (`zCoreBrandKnowledgeV1`, etc.) on the payload immediately before `db.update`.

The interview commit path also validates three times: `config.finaliseDraft` (bucket shape), then the setter's column-level parse, then the V1 column shape (they are the same schema wearing different hats). The redundancy is deliberate — every path into storage passes the same gate regardless of who constructed the payload.

### 6.4 `requireAdmin`

```ts
// packages/server/src/middleware/auth.ts
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.get('user') as AuthUser | undefined;
  if (!user?.adminRole) {
    throw new AppError(403, 'Forbidden — admin access required');
  }
  await next();
});
```

Applied to **all 25 brand/outlet write endpoints** and **all 6 interview POST endpoints**. Read endpoints are open to any authed user (RLS still filters).

---

## 7. Read UI (structural angle)

The frontend read path is **registry-driven and generic**. The UI has one page per bucket, but the page itself is a dispatcher:

```ts
// packages/web/app/brands/_wiki/WikiBucketPage.tsx (sketch)
const bucket = BUCKETS[slug];                        // registry lookup
const { bundle, sources } = outletId
  ? await outletKnowledgeApi.getMerged(outletId)     // merged read
  : { bundle: await brandsApi.getKnowledge(brandId), sources: {} };

return <BucketView bucket={bucket} bundle={bundle} sources={sources} />;
```

The UI `BUCKETS` registry (`packages/web/app/brands/_wiki/bucket-meta.ts`) mirrors the backend registry — same nine entries, same keys, same column assignments. Adding a bucket requires updating both registries, but neither requires touching the dispatcher.

**Source badges.** When viewing an outlet, each sub-bucket card shows a small badge:

- `brand` → "From {Brand Label}"
- `outlet` → "From {Outlet Label}" (overriding the brand value)
- `merged` → "Mixed (Brand + Outlet)" — only for `extended.sections`
- `none` → empty state with "Not yet populated"

The badge comes from the `sources` map the server returns alongside `merged`. The UI does no merging itself — the server is the merge authority and the shared `merge.ts` is the merge source of truth.

---

## 8. Security Posture

| Layer | Protection |
|---|---|
| RLS | Every `/api/*` request runs in a Postgres transaction with `app.current_user_id`, brand/team scopes, and admin role set. `SELECT` on `brands` / `outlets` is RLS-filtered by brand membership. |
| Auth middleware | Supabase JWT verified against JWKS, user hydrated with `adminRole`. |
| `requireAdmin` | Guards all 31 mutating endpoints across wiki + interview. |
| Zod gates | Every payload that reaches jsonb storage is parsed by a column-level V1 schema. Invalid payloads produce `AppError(400)` with field-level messages. |
| Scope fence | Three-layer defence (route / prompt / tool) prevents the LLM from operating outside its bucket. |
| `AppError.statusCode` | Typed error class ensures `c.json({ error }, statusCode)` rather than leaking stack traces. Dev mode appends `details`; production does not. |
| Error boundary (`WikiErrorBoundary`) | React boundary on the wiki routes catches render-time errors and shows a friendly fallback. |
| A11y | `aria-live` on the chat region, `aria-describedby` on all five wiki CRUD modals, focus traps on all modals, `CSS.escape` on dynamic selectors. |

---

## 9. Tests

Two test files cover the deterministic surface:

- `packages/server/src/services/brand-interview/brand-interview.test.ts` — 67 cases covering floor checks for every bucket (empty / partial / met), tool dispatch (valid / invalid / unknown name), session lifecycle, scope-fence enforcement, exam-grade evaluation.
- `packages/shared/src/brand-knowledge/merge.test.ts` — brand+outlet merge at sub-bucket level, source provenance, `extended.sections` id-based merge, schema-version handling.

The LLM-in-the-loop calls (`chatCompletion`, `submitUserTurn`, `generateFinalExam`) are not unit-tested — they're exercised manually. The test pyramid is: **deterministic core heavily covered, LLM boundary manually covered**. If you port this, the same pyramid applies: test what doesn't vary with model output.

---

## 10. File Map

**Data model**
- `packages/server/src/db/schema.ts` — brands, outlets table definitions
- `packages/server/drizzle/migrations/0035_*.sql` — brand jsonb columns
- `packages/server/drizzle/migrations/0036_*.sql` — outlet jsonb columns
- `packages/shared/src/brand-knowledge/core.v1.ts`
- `packages/shared/src/brand-knowledge/visual.v1.ts`
- `packages/shared/src/brand-knowledge/operational.v1.ts`
- `packages/shared/src/brand-knowledge/extended.v1.ts`
- `packages/shared/src/brand-knowledge/merge.ts` — brand+outlet merge

**Bucket registry**
- `packages/server/src/services/brand-interview/buckets/types.ts` — `BucketConfig` shape
- `packages/server/src/services/brand-interview/buckets/index.ts` — registry
- `packages/server/src/services/brand-interview/buckets/{identity,voice-and-tone,target-market,competitive,visual-identity,space-atmosphere,menu-philosophy,service-standards,extras}.ts`
- `packages/web/app/brands/_wiki/bucket-meta.ts` — frontend registry

**Interview agent**
- `packages/server/src/services/brand-interview/session.ts` — in-memory store
- `packages/server/src/services/brand-interview/loop.ts` — turn orchestration
- `packages/server/src/services/brand-interview/final-exam.ts` — exam + grading
- `packages/server/src/services/brand-interview/floor.ts`
- `packages/server/src/services/brand-interview/openrouter.ts` — LLM client

**Routes & services**
- `packages/server/src/routes/brand-interview.ts`
- `packages/server/src/routes/brand-knowledge.ts`
- `packages/server/src/services/brand-knowledge.ts` — per-column setters
- `packages/server/src/services/outlet-knowledge.ts` — merged read

**Frontend**
- `packages/web/app/brands/_wiki/WikiBucketPage.tsx` — generic dispatcher
- `packages/web/app/brands/_wiki/interview/InterviewPage.tsx` — chat UI
- `packages/web/app/brands/_wiki/components/*View.tsx` — one per bucket
- `packages/web/lib/brand-interview-api.ts` — API client

**Tests**
- `packages/server/src/services/brand-interview/brand-interview.test.ts`
- `packages/shared/src/brand-knowledge/merge.test.ts`

---

## 11. Replication Playbook

If you're rebuilding this pattern in a different product, here's the shortest path from zero to working:

1. **Define the domain.** Replace "brand" with your parent entity, "outlet" with your override entity (if any), "bucket" with your content category. Decide how many categories you'll group into how many physical columns — column boundaries should track independent validation + independent setability.

2. **Write the V1 Zod schemas first.** One file per column, one sub-schema per bucket, all extending a common slot (like `zTldrSlot`). Put them in a shared package both frontend and backend import. The schemas are the contract — every other layer references them.

3. **Encode floors inside Zod, not around it.** `.min(3, 'floor: …')` beats an imperative check in the service layer. Zod errors already format cleanly; imperative floor-checkers create a second source of truth.

4. **Add migrations adding nullable jsonb columns.** Nullable because any bucket being present is independently meaningful — the parent entity shouldn't have to be "fully filled in" to be persistable.

5. **Build the merge function in the shared package** with a `sources` provenance map, even if you don't need overrides yet. Adding it later means rewriting every consumer.

6. **Service layer: one setter per column.** The setter is the only legal write path. `ensureParentExists` → `Zod.safeParse` → `UPDATE`. Map Zod errors to `AppError(400, 'path: message; …')`.

7. **Wire up admin CRUD routes first**, Zod-gated, `requireAdmin`-guarded. Confirm the write path works without any LLM in the loop.

8. **Build the `BucketConfig` plugin interface.** Tools (OpenAI function-calling format), `applyToolCall` dispatcher, `systemPrompt` with brand-label placeholder, `opener`, `checkFloor`, `finaliseDraft`, exam prompt, draft summariser, fallback examples. One file per bucket, one registry in a `Map`.

9. **Build the turn loop** with per-turn progress meta messages — the LLM needs to know what's missing *every turn*, not just from the system prompt.

10. **Build the three-layer scope fence** simultaneously with the loop. Don't try to bolt it on later; the shape of the prompt is different when it's designed to stay in scope.

11. **Build the final exam** as a separate step, callable only once the floor is met. Generate examples via LLM with `tool_choice: 'none'`, parse a JSON response, fall back to canned examples if parsing fails.

12. **Commit path re-validates everything** — `finaliseDraft` (bucket) → setter (column) → Zod parse. Do not let the LLM-driven path skip a gate the admin CRUD path goes through.

13. **Frontend read UI is a generic dispatcher.** Registry lookup → data fetch → dispatch to a per-bucket component. The dispatcher doesn't know anything bucket-specific.

14. **Tests cover the deterministic core**: floor checks, tool dispatch, session lifecycle, scope fence, grade evaluation, merge provenance. LLM-boundary tests are manual.

The whole thing is ~5000 lines of TypeScript across three packages once built out for nine buckets. The bulk is per-bucket prompts and per-bucket UI components — the infrastructure (session store, loop, exam, registry, gates) is ~1000 lines and domain-agnostic.
