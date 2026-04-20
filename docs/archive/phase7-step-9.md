# Phase 7 Completion — Step 9

**Status:** Step 9 complete. Steps 10–17 pending.
**Scope:** [phase-7-plan.md](../executing/phase-7-plan.md) §Step 9.
**Verification (post-Step 9):** `pnpm typecheck`, `pnpm lint` — clean across 9 workspaces. Test count: 167 (unchanged; editor logic is exercised via TipTap internals, no isolated units added this step).

---

## Step 9 — Brand editor

**Outcome:** `/brands/:brandId` renders the brand name and a list of guideline sections. Each section has a label field and a TipTap rich-text editor. Sections can be added (blank or from suggested categories), removed, and reordered by drag handle. Save writes the full list via `PATCH /brands/:id/guidelines`; the server returns the canonical list which replaces local state.

### Packages added

- `@tiptap/core`, `@tiptap/react`, `@tiptap/starter-kit` — TipTap editor (v3)
- `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` — drag-and-drop sortable list

### Surface added / replaced

```
packages/web/src/
├── editor/
│   └── proseMirrorSchema.ts         # new — shared TipTap extensions (Step 11 canvas reuses this)
├── api/queries/
│   └── brands.ts                    # updated — added useUpdateBrandGuidelines mutation
└── routes/
    └── brands.$brandId.tsx          # replaced — full implementation (was placeholder)
```

---

### `src/editor/proseMirrorSchema.ts`

`defaultExtensions` — StarterKit configured for headings H1–H3. Exported as `Extensions[]` so both the brand editor and the canvas text-block editor (Step 11) import the same instance. Divergence between the two surfaces would break the planned "promote section to canvas block" flow.

---

### `src/api/queries/brands.ts` — `useUpdateBrandGuidelines`

Calls `PATCH /brands/:id/guidelines` with `UpdateBrandGuidelinesInput`. Server returns `BrandGuidelineSection[]` (not the full `BrandWithSections`). On success: updates the React Query cache via `setQueryData` to merge the new sections into the existing brand entry.

---

### `src/routes/brands.$brandId.tsx`

**Local state model — `LocalSection`.** Each section carries a `_key` (stable React key: the server id for persisted sections, a `crypto.randomUUID()` for new ones), an optional `id` (omitted for new sections so the server inserts instead of updating), `label`, `body` (`ProseMirrorDoc`), and `priority`.

**`BrandEditorPage`** — fetches `BrandWithSections` via `useBrand`. Once loaded, renders `<BrandEditorForm key={brand.id} brand={brand} />`. Using `key={brand.id}` means the form remounts only if the user navigates to a different brand — not on every query refetch — so in-progress edits are safe.

**`BrandEditorForm`** — initialises `sections` state from `brand.sections` via a lazy `useState` initializer (no `useEffect`). Contains the full editing surface:

- **dnd-kit sortable.** `DndContext` + `SortableContext` with `verticalListSortingStrategy`. `PointerSensor` uses `activationConstraint: { distance: 8 }` so clicks inside the TipTap editor (for cursor placement / text selection) don't accidentally start a drag. `KeyboardSensor` added for accessibility. `handleDragEnd` calls `arrayMove` and rebuilds `sections` with the new order.
- **Add section.** "+ Add section" button appends a blank `LocalSection`.
- **Suggested categories strip.** Renders chips for entries from `SUGGESTED_SECTIONS` (imported from `@brandfactory/shared`) that don't already have a matching label in `sections`. Clicking a chip adds a pre-labelled blank section. Hidden once all suggestions are in use.
- **Save.** Rewrites `priority` to `(index + 1) * 1000` on the outgoing payload (stable sparse integers, no sibling updates). Calls `mutation.mutate(payload, { onSuccess })`. `onSuccess` receives the server's canonical `BrandGuidelineSection[]` and calls `setSections(serverSections.map(toLocal))` — replaces local state with the authoritative list. Toast on success/error.

**`SectionRow`** — one section in the sortable list:

- `useSortable({ id: section._key })` provides `setNodeRef`, `transform`, `transition`, drag `attributes` and `listeners`. The `GripVertical` handle receives `{...attributes} {...listeners}` so the drag zone is the handle only, not the editor body.
- `useEditor` (from `@tiptap/react`) initialised with `defaultExtensions` and `content: section.body`. `onUpdate` callback calls `onBodyChange(key, editor.getJSON())` to keep parent state in sync. The `content` prop is only used on mount; TipTap manages content internally after that, so re-renders with new `body` prop don't reset the editor.
- `useCallback` on `onLabelChange`, `onBodyChange`, `onRemove` with empty dependency arrays (all use the functional `setSections` form) prevents unnecessary re-renders of `SectionRow` instances that aren't being edited.
- Dual casts for TypeScript: `section.body as Record<string, unknown>` satisfies TipTap's `Content` type; `s.id as SectionId` satisfies the branded `SectionId` in `UpdateBrandGuidelinesSectionInput`.

**Back-link.** When brand is loaded, links to `/workspaces/$wsId` using `brand.workspaceId`. While loading, falls back to `/workspaces`.
