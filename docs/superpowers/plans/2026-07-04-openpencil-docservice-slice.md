# Estúdio v2 — Slice 3: Doc Service (render + validation + tipo-sync) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Saved designs render again: a stateless Vercel Node service turns `.fig` blobs into per-frame JPEGs (emoji included), the `design-render` edge function orchestrates it through the existing claim/finalize/publish machinery, `tipo` syncs from the frames, and the loop is live-verified on prod (post 1041: save → rendered JPEGs attached as `origin='design'` media).

**Architecture:** Two halves with a hard security boundary. **Vercel service (`services/estudio-render/`) = pure compute**: `.fig` bytes in → frame classification + validation + JPEGs out; its only secret is a shared bearer (`RENDER_SERVICE_SECRET`) — no Supabase or R2 credentials ever reach Vercel. **Edge orchestrator = the reworked `design-render` fn**: keeps its v1 trigger contract (`x-cron-secret`, `{design_id, rev}`) so post-design-manage's trigger, the sweep cron, and the publish-gate re-check all keep working unchanged; internally it swaps satori for claim → blob fetch → service call → R2 uploads → the existing `finalize_design_render`/`fail_design_render` RPCs → tipo-sync. v1's chunked self-invocation dies (renders are IO-bound now); the sweep cron still rescues stuck rows.

**Tech Stack:** `@open-pencil/core@0.13.2` (same pin as fork + templates — render parity), `canvaskit-wasm@0.41.1`, Noto Color Emoji (CBDT), Vercel Node fns, Deno edge, node:test for the service.

## Global Constraints

- Same `@open-pencil/core` version everywhere (fork / templates / service) — parity depends on it.
- **Emoji is a hard requirement**: 'OI 🔥' must render a real glyph in the service output (visual check, not just byte-diff). Candidate mechanism (verified in recon): `fontManager.markLoaded('Noto Color Emoji','Regular',bytes)` + `fontManager.setCJKFallbackFamily('Noto Color Emoji')` (additive — appends to every paragraph's fallback list). If CBDT fails in CanvasKit, fall back to the COLRv1 build; if both fail, stop and regroup (twemoji substitution is the last resort).
- Frame presets (spec §4): 1:1→1080×1080, 4:5→1080×1350, 9:16→1080×1920. Publishable = aspect matches a preset (±0.5% tolerance); export renders at preset pixel size regardless of on-canvas frame size (scale = presetW/frame.width). Order: numeric name prefix, else left-to-right x. Rules: carousel ≤ **10** frames, uniform aspect; `reels` tipo → first 9:16 frame is the cover; ≥1 publishable frame required.
- Render keys follow v1's scheme (read it from the v1 handler during Task 3 and reuse verbatim) so `finalize_design_render`'s manifest contract (`[{page_id, r2_key, bytes, width, height}]`, `page_id` := frame id) and R2 cleanup keep working.
- Secrets: generated to files, moved via stdin/`--env-file` only (house rule — never literal CLI args). `supabase secrets set` targets PROD explicitly (`--project-ref skjzpekeqefvlojenfsw`); repo links to staging.
- Errors surfaced to tenants (`render_error`) stay sanitized (v1 rule); raw service errors are logged only.
- CI parity before finishing: `npm run test:functions` (Deno), service `node --test`, `npm run format && npm run lint`, revert root `deno.lock` if polluted.
- The migration (Task 1) is applied by Eduardo via the SQL editor (established flow) — batch the ask with the deploy step, everything else is buildable without it.

---

### Task 1: Migration — blob-aware claim

**Files:**
- Create: `supabase/migrations/20260704000002_claim_design_render_blob.sql`

**Interfaces:**
- Produces: `claim_design_render_blob(p_design_id bigint)` → `TABLE (design_id bigint, conta_id uuid, post_id bigint, doc_r2_key text, doc_hash text, editor_version text)`, service_role-only. Same claim semantics as v1 (`pending`→`rendering` atomically, manifest reset, `render_started_at` stamped) — copy the v1 body from migration `20260702000004` and swap the returned columns (`doc` jsonb → `doc_r2_key`/`editor_version`).

- [ ] **Step 1:** Read `20260702000004_claim_design_render_reap_stale_manifest.sql` fully; write the new function preserving its claim guard/locking exactly (including any reap behavior tied to claiming), returning the blob columns.
- [ ] **Step 2:** Commit. (Apply happens in Task 5 with the user.)

---

### Task 2: The render service (`services/estudio-render/`)

**Files:**
- Create: `services/estudio-render/package.json` (deps: `@open-pencil/core@0.13.2`, `canvaskit-wasm@0.41.1`; `"type":"module"`)
- Create: `services/estudio-render/vercel.json` (`memory: 1769, maxDuration: 60, includeFiles: "{assets,node_modules/@open-pencil/core/node_modules/canvaskit-wasm/bin/full,node_modules/canvaskit-wasm/bin/full}/**"`)
- Create: `services/estudio-render/lib/frames.js` (pure classification — no wasm)
- Create: `services/estudio-render/lib/render.js` (init + doc load + frame export)
- Create: `services/estudio-render/api/render.mjs` (HTTP surface)
- Create: `services/estudio-render/test/frames.test.js`, `test/render.test.js` (node:test)
- Add: `services/estudio-render/assets/NotoColorEmoji.ttf` (googlefonts/noto-emoji, OFL — add `assets/ATTRIBUTION.md`), `assets/inter-400.ttf`, `assets/inter-700.ttf` (copied from `public/fonts/estudio/inter/`)

**Interfaces (frozen for Task 3):**

```
POST {SERVICE_URL}/api/render
  headers: authorization: Bearer {RENDER_SERVICE_SECRET}, x-post-tipo: feed|carrossel|reels,
           content-type: application/octet-stream
  body: .fig bytes (≤ 10MB)
  → 200 {
      validation: { ok: boolean, errors: [{ code, message }] },     // codes below
      derived:    { format: "feed"|"carrossel"|"reel_cover"|null, tipo: "feed"|"carrossel"|"reels"|null },
      frames:     [{ id, name, order, aspect, publishable }],
      pages:      [{ frame_id, width, height, jpeg_b64 }]           // publishable frames only; [] when !ok
    }
  → 401 (bad secret) | 413 | 422 (unparseable .fig)
validation codes: no_publishable_frames | mixed_aspects | too_many_frames (>10) | no_cover_frame (reels)
```

- [ ] **Step 1: Write the failing frame-classification tests** — pure logic, no wasm:

```js
// test/frames.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyFrames } from '../lib/frames.js'

const f = (over = {}) => ({ id: 'a', name: '1', x: 0, width: 1080, height: 1350, ...over })

test('publishable presets, order by numeric prefix then x', () => {
  const out = classifyFrames([
    f({ id: 'b', name: 'scratch', width: 500, height: 500 }),      // off-preset (aspect 1:1 but… 500×500 IS 1:1 → publishable!)
    f({ id: 'c', name: '2', x: 9999 }),
    f({ id: 'a', name: '1', x: 0 }),
  ], 'carrossel')
  assert.deepEqual(out.frames.filter(x => x.publishable).map(x => x.id), ['a', 'c', 'b'])
})

test('aspect tolerance: 1081×1350 within 0.5% of 4:5 → publishable', () => {
  const out = classifyFrames([f({ width: 1081, height: 1350 })], 'feed')
  assert.equal(out.frames[0].publishable, true)
  assert.equal(out.frames[0].aspect, '4:5')
})

test('derived: 1 frame → feed, 2+ → carrossel, cap 10', () => {
  assert.equal(classifyFrames([f()], 'feed').derived.tipo, 'feed')
  assert.equal(classifyFrames([f(), f({ id: 'b', name: '2' })], 'feed').derived.tipo, 'carrossel')
  const eleven = Array.from({ length: 11 }, (_, i) => f({ id: `f${i}`, name: `${i + 1}` }))
  assert.equal(classifyFrames(eleven, 'carrossel').validation.errors[0].code, 'too_many_frames')
})

test('mixed aspects on a carousel → error', () => {
  const out = classifyFrames([f(), f({ id: 'b', name: '2', width: 1080, height: 1080 })], 'carrossel')
  assert.equal(out.validation.errors[0].code, 'mixed_aspects')
})

test('reels: first 9:16 frame is the cover; none → no_cover_frame', () => {
  const out = classifyFrames([f({ width: 1080, height: 1920 })], 'reels')
  assert.equal(out.derived.format, 'reel_cover')
  assert.equal(classifyFrames([f()], 'reels').validation.errors[0].code, 'no_cover_frame')
})
```

NOTE the first test's lesson: an off-preset frame is one whose ASPECT matches no preset — a 500×500 frame IS 1:1 and therefore publishable (exported at 1080²). Scratch space = non-preset aspect ratios. Encode exactly that.

- [ ] **Step 2: Implement `lib/frames.js`** — `classifyFrames(frames, tipo)` with the preset table, tolerance, ordering (numeric `^\d+` prefix wins, then x), aspect-uniformity for multi-frame feed/carrossel, cap 10, reels cover pick, and `{validation, derived, frames}` result. Tests green.
- [ ] **Step 3: Implement `lib/render.js`** — module-scope lazy init (spike lesson: lazy, structured errors): `initCanvasKit()`, register Inter 400/700 + Noto Color Emoji (`markLoaded` + `setCJKFallbackFamily('Noto Color Emoji')`); `renderDocument(bytes, tipo)` = `io.readDocument` → `computeAllLayouts` → find the content page (first page with children) → `classifyFrames` → for each publishable frame `io.exportContent('jpg', {graph, target:{scope:'node', nodeId}}, {format:'JPG', scale: presetW / frame.width, quality: 90})`.
- [ ] **Step 4: Render test with emoji** (`test/render.test.js`): build a doc in-test (SceneGraph: 1080×1350 frame + TEXT `OI 🔥` fontFamily Inter 700) → `renderDocument` → assert 1 page, JPEG magic, plausible size; write `out/emoji-check.jpg` for the visual gate. **Run, then LOOK at the JPEG** — a real flame glyph is the pass bar (Global Constraints). Also render the committed feed starter template as a second case.
- [ ] **Step 5: `api/render.mjs`** — bearer check (`process.env.RENDER_SERVICE_SECRET`, timing-safe compare), size cap, `x-post-tipo` validation, try/catch → `{error, stack?}` never leaks to non-200s beyond a generic message + logged detail. Local check via the same fake req/res harness used in the spike.
- [ ] **Step 6: Commit.**

---

### Task 3: Rework the `design-render` edge orchestrator

**Files:**
- Rewrite: `supabase/functions/design-render/handler.ts` (drop satori/render-core/tree imports; keep the deps-injection shape and the trigger contract)
- Rewrite: `supabase/functions/design-render/index.ts` (wire claim-blob RPC, blob fetch, service call, R2 upload, finalize/fail, tipo-sync)
- Rewrite: `supabase/functions/__tests__/design-render_test.ts`
- Delete: `supabase/functions/__tests__/design-render-core_test.ts`, `design-render-tree_test.ts`, `estudio-render-parity_test.ts`, `design-doc-schema_test.ts` ONLY IF they fail from this change — otherwise leave for the cutover slice (they test still-present shared modules).

**Interfaces:**
- Consumes: `claim_design_render_blob` (Task 1), the service contract (Task 2), existing `finalize_design_render(p_design_id, p_claimed_hash, p_manifest)` / `fail_design_render(p_design_id, p_error)`, `getObjectBytes`/`putObject` (r2.ts), v1's render R2 key scheme.
- Produces: same trigger contract as v1 — `POST /design-render` with `x-cron-secret` + `{design_id, rev}`; 204 nothing-to-do, 409 claim lost. Sweep cron and publish-gate re-check need ZERO changes.

- [ ] **Step 1: Read the v1 handler end-to-end first** (claim flow, manifest write, finalize call, R2 key scheme for rendered pages, failure paths, the 204/409 semantics) — the rewrite preserves every externally-visible behavior.
- [ ] **Step 2: Rewrite tests** (deps-injected, mirroring the v1 test file's harness): happy path (claim → fetch blob → service 200 → N putObject calls with v1-scheme keys → finalize with correct manifest + claimed hash → tipo-sync UPDATE when derived.tipo ≠ current), validation-failure path (service `ok:false` → `fail_design_render` with the sanitized code, NO uploads), service 5xx/timeout → fail + logged, claim-lost → 409, cron-secret missing → 401, blob missing in R2 → fail.
- [ ] **Step 3: Implement.** Handler outline:

```ts
// after x-cron-secret check + body parse (unchanged from v1):
const claimed = await deps.claimDesignRenderBlob(design_id);
if (!claimed) return json({ error: "render_in_progress" }, 409);
try {
  const bytes = claimed.doc_r2_key ? await deps.fetchBlob(claimed.doc_r2_key) : null;
  if (!bytes) return await failWith("design_blob_missing");
  const result = await deps.callRenderService(bytes, claimed.post_tipo);   // POST, Bearer secret, x-post-tipo
  if (!result.validation.ok) return await failWith(result.validation.errors[0]?.code ?? "invalid_design");
  const manifest: ManifestEntry[] = [];
  for (const page of result.pages) {
    const key = deps.renderKey(claimed, page);          // v1 scheme, read in Step 1
    await deps.putRender(key, page.jpegBytes);          // decoded from jpeg_b64 in index.ts wiring
    manifest.push({ page_id: page.frame_id, r2_key: key, bytes: page.jpegBytes.length, width: page.width, height: page.height });
  }
  const outcome = await deps.finalizeDesignRender(design_id, claimed.doc_hash, manifest);
  if (outcome === "ok" && result.derived.tipo && result.derived.tipo !== claimed.post_tipo) {
    await deps.syncPostTipo(claimed.post_id, claimed.conta_id, result.derived.tipo); // editable statuses only
  }
  return json({ ok: true, outcome, pages: manifest.length });
} catch (e) {
  deps.logError("design-render:render", e);
  return await failWith("render_failed");
}
```

`claimed.post_tipo` comes from a post lookup in index.ts wiring (the claim RPC doesn't return tipo — join it there). `syncPostTipo` = service-role `UPDATE workflow_posts SET tipo = $1 WHERE id AND conta_id AND status IN (editable)` — matches v1 check_and_sync's rule without doc parsing.
- [ ] **Step 4:** `npm run test:functions` fully green (fix any collateral in gate/sweep tests — their contracts didn't change, so failures mean a real regression). Commit.

---

### Task 4: Re-arm the render trigger in post-design-manage

**Files:**
- Modify: `supabase/functions/post-design-manage/handler.ts` (+deps `triggerRender`, `waitUntil`; fire after successful PUT save and after mint)
- Modify: `supabase/functions/post-design-manage/index.ts` (wire `createDesignRenderTrigger(SUPABASE_URL, CRON_SECRET)` — the shared module is unchanged from v1; CRON_SECRET env requirement returns)
- Modify: `supabase/functions/__tests__/post-design-manage_test.ts` (assert trigger fired on PUT-success + mint, NOT on 409/413/422)

- [ ] **Step 1:** Tests first (three new assertions on the spy), fail, implement (fire-and-forget via `waitUntil`, same idiom as v1: `.catch(logError)`), green, commit.

---

### Task 5: Deploy + secrets + live E2E on prod

- [ ] **Step 1: Generate the shared secret** to a scratch file (`openssl rand -hex 32 > $SCRATCH/render-secret`); set on Vercel (`vercel env add RENDER_SERVICE_SECRET production < $SCRATCH/render-secret` in `services/estudio-render/`, project `mesaas-estudio-render`) and on Supabase prod (`--env-file` with RENDER_SERVICE_URL + RENDER_SERVICE_SECRET, `--project-ref skjzpekeqefvlojenfsw`). Never echo the secret.
- [ ] **Step 2: Deploy the service** (`vercel link --project mesaas-estudio-render && vercel deploy --prod --yes`), disable SSO protection for it (it has its own bearer auth — same API call as the spike), smoke it with the starter template bytes from the repo + the secret from the file.
- [ ] **Step 3: Ask Eduardo to apply migration `20260704000002`** (SQL editor, prod). Blocked until confirmed.
- [ ] **Step 4: Deploy edge fns** — `design-render` and `post-design-manage`, `--use-api --no-verify-jwt --project-ref skjzpekeqefvlojenfsw`.
- [ ] **Step 5: Live E2E on post 1041** (in-page pattern from slice 2 — token never surfaces): craft a doc with visible text + 🔥 (Node script mutating the starter template bytes), PUT via `/blob` at current rev → poll `post_designs` until `render_status='rendered'` + `is_stale=false` → assert `post_file_links` rows with `origin='design'` exist → fetch the signed render URL → **view the JPEG** (text + emoji visible) → post 1041 `tipo` stays feed (1 frame). Then add a second frame in the doc, PUT again → verify tipo flips to `carrossel` after render.
- [ ] **Step 6: Sweep-cron sanity** — confirm the pending-row noise from slice 2 is gone (post 1041 now rendered; no rows stuck pending; `render_error` clean).

---

### Task 6: Docs + wrap-up

- [ ] Update `docs/estudio-v2-editor-contract.md` (render pipeline note: renders happen server-side after save; publish gate semantics unchanged), NOTES.md evidence, memory (slice 3 state + gotchas), commits. Report with the rendered JPEG as evidence.
