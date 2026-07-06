# Estúdio slice C — image → editable design ("Tornar editável") — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A raw image already uploaded to a post becomes an editable Estúdio design in one
click (spec: `docs/superpowers/specs/2026-07-04-estudio-design-first-model.md` §"Image →
editable design"). Pipeline: vision pass extracts the text blocks, an image-edit pass
reconstructs a clean text-free background (1 unit of the AI-image quota), and the doc
service composes a fresh `.fig` (background image fill + editable text layers). The design
is created **attached but held**: post media is NOT replaced until the user's first save in
the editor — they confirm fidelity before the design takes over the post.

**Architecture:** One new edge function `design-import` (Bearer JWT verified in-app,
`verify_jwt = false`, same as design-manage) orchestrates: eligibility → vision + inpaint
in parallel → doc-service compose → `create_design` RPC with a new media-hold flag → render
kick. The inpaint rides the existing `generateImageCore` (quota/ledger/burst/idempotency/R2
untouched — the import is just another caller). The doc service grows `POST /api/compose`
(fresh-graph build — the proven-safe headless path; no read-modify-write). The hold is a
new `designs.media_apply_held` column: `finalize_design_render` stores the manifest instead
of applying media while held; `save_design_blob` clears it on the first user save.

**Tech Stack:** Deno edge functions (deps-injected handlers + `npm run test:functions`),
Postgres SECURITY DEFINER RPCs, Node doc service (`services/estudio-render`, CanvasKit +
`@open-pencil/core`), React 19 + TanStack Query, Vitest.

## Design decisions (locked by this plan — raise before deviating)

1. **Scope: feed + carrossel posts only.** Reels covers are excluded from v1: the cover is
   a video `thumbnail_r2_key`, not a first-class image file, and needs its own flow.
   Follow-up, not here.
2. **Whole-post import, single AI treatment.** The action lives on ONE image tile, but the
   composed design gets a frame for EVERY image media of the post (post `sort_order` order,
   numeric frame names `1..N` so `classifyFrames` keeps the order): the clicked image gets
   the vision+inpaint treatment (clean background + text layers); sibling images become
   plain background-image frames (no AI, no quota). Rationale: a 1-frame design attached to
   a 3-image carrossel would tipo-sync the post to feed and destroy media on first save —
   frame-per-media keeps tipo and media replacement 1:1. Cost stays 1 quota unit per import.
3. **Hold mechanism = `designs.media_apply_held boolean NOT NULL DEFAULT false`.**
   - `create_design` gains `p_media_hold boolean DEFAULT false` (existing callers
     unchanged); only meaningful when created attached.
   - `finalize_design_render`: `v_apply_media := <attached+editable> AND NOT
     media_apply_held`. While held the manifest is stored on the row (same branch as
     unattached) → gallery/home thumbnails work, post media untouched.
   - `save_design_blob` clears the hold (first save — including the editor's autosave
     after the first edit — is the fidelity confirmation; the composed doc has
     `clipsContent: true` everywhere so boot normalization never dirties it unprompted).
   - `attach_design` and `detach_design` clear the hold (explicit attach = user intent;
     a detached design is an ordinary design again).
   - Publish gate treats held as not-ready (a held design's post still shows the ORIGINAL
     media — publishing must wait for confirmation or detach).
4. **Compose input = presigned R2 GET URLs, not embedded bytes.** The edge function
   presigns each source image (`_shared/r2.ts`) and POSTs plain JSON; the doc service
   fetches them (30s timeout each). No MDF1 framing, no request-size cliff on N-image
   carousels.
5. **Compose downscales every image to its frame's preset size** (CanvasKit decode → scale
   → JPEG ~85) before embedding in the `.fig`. Exports happen at preset size anyway
   (1080×1080 / 1080×1350 / 1080×1920), so nothing is lost, and a 10-frame carrossel stays
   far under the 10MB blob ceiling (`MAX_BLOB_BYTES`).
6. **Frame preset from the clicked image's aspect** (nearest of 1:1 / 4:5 / 9:16, same
   ±0.5%-free nearest-match since sources are arbitrary). ALL frames share that preset
   (`classifyFrames` rejects mixed aspects); siblings cover-crop into it (`scaleMode FILL`).
7. **Vision pass is not quota-counted** (it costs ~cents; the inpaint is the spend). It IS
   burst-guarded by the same conta rate-limit key family (`imgimport:conta:` 20/h) so a
   loop can't hammer OpenRouter.
8. **Inpaint idempotency key = `design-import:file:{file_id}`.** Stable across retries: a
   failed compose retried later replays the background for free (CAS reuse, mandatory per
   house rules). The prompt is fixed (PT: remove ALL text/typography, reconstruct the
   background naturally, change nothing else), `placement: 'background'` (2K),
   `referenceFileIds: [file_id]`, aspect = the chosen preset's ratio.
9. **Vision model:** OpenRouter chat completions, `google/gemini-3.1-flash` (vision-capable
   flash tier) — **verify the slug against `openrouter.ai/api/v1/models` at implementation
   time** (house precedent: the image slug was verified the same way). Structured output:
   ask for strict JSON (`response_format: {type: 'json_object'}` if the route supports it,
   tolerant first-JSON-block parser either way), then validate hard: text blocks
   `{text, bbox: {x,y,w,h} normalized 0–1, size (fraction of image height), weight
   400|700, color: #rrggbb, align: left|center|right}`; drop invalid blocks; cap 20;
   fontFamily is ALWAYS Inter (the only family both the editor embed and the render
   service resolve for sure); clamp weight to 400|700.
10. **MCP `import_image_as_design` is OUT of this slice** (spec: "after slice C").
    Follow-up alongside reels covers and the panorama-split helper.

## Global constraints (house rules — violating these has bitten us before)

- Repo's supabase CLI link points at STAGING. Prod is `skjzpekeqefvlojenfsw`. ALWAYS
  `cat supabase/.temp/project-ref` before any `--linked` command. Prod deploys:
  `npx supabase functions deploy <fn> --use-api --project-ref skjzpekeqefvlojenfsw`
  (Docker bundler broken; `--use-api` mandatory). `--no-verify-jwt` for functions that do
  their own auth (design-import qualifies) but NEVER for `instagram-publish` or
  `mcp-oauth-consent` (gateway JWT stays on).
- Migrations are applied to PROD BY EDUARDO via the SQL editor (db push blocked by the
  dup-timestamp). Write the file, validate behaviorally on a throwaway Postgres, then STOP
  and ask him to apply; verify after.
- Edge tests: `npm run test:functions` (bare `deno test` breaks on zod resolution). Root
  `deno.lock` changes: always revert. `supabase/functions/deno.lock`: only intentional
  dep adds.
- Doc-service tests are NOT in CI — run `npm test` inside `services/estudio-render`
  manually. Deploy it with `npx vercel deploy --prod --yes` from that directory
  (project `mesaas-estudio-render`). Deno's `--node-modules-dir` pollutes the shared
  `node_modules` — if it happens, `npm ci`.
- Frontend gates: `npm run test`, `npm run build`, `npm run lint` (0 errors),
  `npx prettier --write` on touched files.
- Never pass secrets as CLI literals; never materialize auth tokens into the transcript
  (in-page fetch pattern for prod probes). No raw prod DB writes — use the app/UI.
  Never touch Eduardo's real designs/posts during E2E; delete all test residue.
- Contract changes: grep BOTH test suites for the old shape
  (`apps/**/__tests__` + `supabase/functions/__tests__`).

## Tasks

### Task 1 — Migration `20260706000002_design_import_media_hold.sql`

- [ ] `ALTER TABLE designs ADD COLUMN media_apply_held boolean NOT NULL DEFAULT false;`
- [ ] `CREATE OR REPLACE` the four RPCs **on top of the 20260706000001 bodies** (they are
  the current source of truth — enviado_cliente already in the editable lists):
  - `create_design(..., p_media_hold boolean DEFAULT false)` — sets the column (force
    false when `p_post_id IS NULL`).
  - `save_design_blob` — adds `media_apply_held = false` to its designs UPDATE.
  - `attach_design` / `detach_design` — clear the hold.
  - `finalize_design_render` — `v_apply_media := ... AND NOT v_media_held` (read the flag
    in the same row lock); the held branch stores `p_manifest` on the row (existing
    unattached branch already does this — route held through it).
- [ ] Behavioral validation on throwaway Postgres (same harness as 20260706000001): apply
  base schema + 20260705000001 + 20260706000001 + this file; cases: (1) import-created
  held design renders → manifest stored, post media rows untouched, `is_stale=false`;
  (2) first `save_design_blob` clears hold → next finalize applies media + tipo-sync;
  (3) attach/detach clear the hold; (4) `create_design` old 6-arg call shape still works
  (default false); (5) held + non-editable post status → finalize stores manifest only
  (no exception).
- [ ] STOP: Eduardo applies to prod via SQL editor (record version). Additive + defaulted
  — old deployed functions are unaffected pre-deploy.

### Task 2 — Doc service: `POST /api/compose`

`services/estudio-render/api/compose.mjs` + `lib/compose.js`. Same bearer auth
(`authorized(req)`), plain JSON body:

```
{ preset: '1:1'|'4:5'|'9:16',
  frames: [ { name: '1', image: { url, mime } } , ... ],   // post sort_order order
  texts:  [ { frame: 0, text, bbox:{x,y,w,h}, size, weight, color, align } ] }
```

- [ ] `lib/compose.js` — `composeDocument(input, fetchImpl)`:
  - Fresh graph via `@open-pencil/core` (page → one FRAME per entry at the preset's pixel
    size, `clipsContent: true`, numeric names) — mirror the starter-build approach in
    `scripts/estudio/build-starter-figs.mjs` for graph/image APIs (image registration =
    whatever the fork's editor image-import uses; spike proof 3 established the headless
    path).
  - Per frame: fetch image (30s timeout, reject non-2xx), CanvasKit decode → downscale to
    preset dims (cover-crop) → JPEG re-encode → register in `graph.images` → background
    rect/frame fill `scaleMode FILL`.
  - Text nodes on their target frame: bbox×frame-dims → x/y/width/height, `fontSize =
    size × frame height` (clamp 12–200), Inter + weight, solid color fill, alignment.
  - `ensureExportSafeGuids(graph)` → `io.writeDocument('fig')` → return bytes; enforce
    output ≤ `MAX_BLOB_BYTES` (`doc_too_large` DocError otherwise).
- [ ] `api/compose.mjs` — thin handler: 405/401/413 guards, coded 422 on `DocError`
  (`invalid_compose_spec`, `image_fetch_failed`, `doc_too_large`), returns
  `application/octet-stream` `.fig` bytes.
- [ ] Tests `test/compose.test.js` (mock fetch with fixture image bytes): frame count and
  preset dims in the `describeDocument` projection; text nodes present with mapped
  bounds/style; image fills registered; round-trips through `renderDocument` producing N
  JPEGs (render smoke = the parity gate); rejects bad specs with coded errors.
- [ ] Extend `_shared/doc-service.ts` client with `compose(spec)` (JSON POST → bytes,
  55s timeout) + Deno test.
- [ ] Deploy to Vercel prod (additive endpoint, safe to ship before the edge function).

### Task 3 — Vision module `_shared/image-gen/vision.ts`

- [ ] `extractTextBlocks({imageBytes, mime, apiKey}, signal?)` → validated block list per
  decision 9. OpenRouter chat completions, 60s timeout, ONE retry on 429/5xx/timeout
  (mirror `openrouter.ts` conventions: raw payloads logged internally, typed errors only).
  Moderation-style 403 → treat as `vision_failed` (not safety_refusal — nothing was
  generated). Empty result (image has no text) is VALID → `[]` (import proceeds:
  background reconstruction may still be worth it, e.g. a logo-only image; the compose
  simply has no text layers for that frame).
- [ ] Key resolution: reuse the resolved OpenRouter key (`OPEN_ROUTER_API_KEY` ??
  `OPENROUTER_API_KEY`); expose a small `resolveVisionConfig()` beside
  `resolveImageProvider()` so both entrypoints (future MCP tool) can't drift. No
  OpenRouter key → `vision_unavailable` (Gemini fallback for vision is a follow-up; the
  import REQUIRES OpenRouter for now — prod has the key).
- [ ] Deno tests with mocked fetch: happy path, tolerant JSON extraction, invalid-block
  dropping, cap at 20, retry-then-fail, no-key error.

### Task 4 — Edge function `design-import`

`supabase/functions/design-import/{handler.ts,index.ts}` (deps-injected handler; index
wires the same concrete deps design-manage/generate-image use). `config.toml`:
`verify_jwt = false`.

- [ ] `POST /` body `{post_id, file_id}`. Order of operations:
  1. CORS/OPTIONS → auth (getUser/getProfile) → `feature_estudio` AND `feature_ai_images`
     (coded `feature_disabled` + which feature).
  2. Eligibility (mirror design-manage create-attached, same coded errors): post in conta;
     tipo `feed|carrossel` (`post_tipo_unsupported` — reels included here for v1); status
     editable incl. enviado_cliente (`post_not_editable`); no video media (`post_has_video`);
     no design attached (`post_already_designed`, pre-check — the RPC re-checks
     transactionally).
  3. `file_id` must be an IMAGE file in this conta AND linked to this post
     (`invalid_reference` otherwise — uniform message, never reveal foreign existence).
     Load all image media links of the post (sort_order order) — these are the frames.
  4. Burst gate `imgimport:conta:{conta_id}` 20/h.
  5. In parallel (`Promise.all`): vision pass on the clicked image's bytes + inpaint via
     `generateImageCore` (decision 8 — its own gates/ledger/quota run inside; a
     `quota_exhausted`/`rate_limited`/`safety_refusal` from the core maps straight out).
  6. Presign: background file's `r2_key` (from the core's `file_id` output) + every
     sibling image's `r2_key` → `docService.compose(spec)` (clicked frame gets the
     background URL + text blocks; siblings get their original URLs, no texts).
  7. `putBlob` composed bytes (`designs/{conta}/{uuid}-r1.fig`) → `create_design` RPC with
     `p_media_hold = true` (name: `Import — {post title|id}`) → audit
     (`estudio.import_image`, metadata: post_id, file_id, background_file_id, frame_count,
     text_block_count, model, cost_usd_estimate — NEVER the extracted text content) →
     `fireRender` (waitUntil, fire-and-forget) → `201 {design_id, quota}`.
  - Failure envelope: `{error: {code, message(PT), retryable}}` (§8 style, statuses via
    the generate-image mapping + `vision_failed`/`compose_failed`/`vision_unavailable`
    → 502, eligibility codes → 403/404/409/422 as in design-manage). On failure AFTER the
    inpaint succeeded: the background file row stays (it's a normal AI-gen asset; the
    idempotency key makes the retry free) — log, don't try to unwind quota.
- [ ] Deno tests (`supabase/functions/__tests__/design-import.test.ts`, fully mocked
  deps): gate order (feature → eligibility → burst → spend: assert NO provider call when
  any gate fails); reels rejected; enviado_cliente accepted; foreign file uniform error;
  carrossel builds N frames with clicked-frame texts only; hold flag passed to RPC; audit
  has no text content; §8 envelope mapping; render kicked with rev 1.

### Task 5 — Publish gate: held designs are not ready

- [ ] `_shared/instagram-publish-utils.ts` `designReadiness`: select `media_apply_held`;
  `ready = render_status==='rendered' && !is_stale && !media_apply_held`. Wire the
  held case into the existing not-ready reason surfacing (same bucket as stale — the
  publish path re-renders/blocks identically; no new user-facing string needed unless the
  helper already distinguishes reasons — follow the existing shape).
- [ ] Grep both test suites for `designReadiness`/readiness fixtures and update
  (`is_stale`-style fixtures gain the new column).
- [ ] Redeploy list for this shared change (record in the deploy task): `instagram-publish`
  (NO `--no-verify-jwt`), `hub-approve`, `instagram-publish-cron`, `design-manage`.

### Task 6 — CRM: entry point, confirm dialog, held-state surfacing

- [ ] `store/designs.ts`: add `media_apply_held` to `DesignSummary` + `DESIGN_COLUMNS`;
  new `importDesignFromMedia(postId, fileId): Promise<{design_id}>` calling
  `functions/v1/design-import` (parse the `{error:{code}}` envelope; throw the code).
- [ ] `PostMediaGallery`: new optional prop `onMakeEditable?: (media: PostMedia) => void`.
  When present, image tiles (kind==='image', `origin !== 'design'`) get a hover action
  (Wand2 icon, `title` from i18n) beside set-cover. The gallery stays dumb — ALL
  eligibility lives in the caller.
- [ ] `WorkflowDrawer`: pass `onMakeEditable` only when: `!estudioBlocked` AND
  `features.feature_ai_images !== false` (fail-open, same pattern) AND
  `designSummary === null` AND `post.tipo` in feed|carrossel AND
  `POST_EDITABLE_STATUSES.includes(post.status)`. Handler opens the confirm dialog.
- [ ] `ImportToEstudioDialog` (new, `pages/estudio/`): shadcn AlertDialog — explains what
  happens (texts become editable layers, background reconstructed by AI, **consumes 1
  image of the monthly AI quota**; carrossel: "as N imagens do post viram páginas do
  design"), long-running state (spinner + "pode levar até um minuto"), error mapping to PT
  (`quota_exhausted`, `rate_limited`, `safety_refusal`, `post_*` codes, generic). On
  success: invalidate `['post-design-summary', postId]` + navigate(`/estudio/${design_id}`).
- [ ] Held-state surfacing (small, load-bearing — the gallery locks while media still
  shows the originals, which is otherwise confusing):
  - `WorkflowDrawer`/`PostMediaGallery` ownership banner: when `design.media_apply_held`,
    swap the banner text for the held variant ("A arte importada ainda não substituiu as
    mídias — abra no Estúdio e salve para aplicar.").
  - `EstudioPage` (shell): when the loaded design is attached+held, show a slim banner
    (reuse the read-only banner slot/pattern): "Confira a fidelidade do design — ao salvar,
    ele substitui as mídias do post."
- [ ] i18n: new keys in `packages/i18n/locales/{pt,en}/estudio.json` (+`posts.json` for
  the gallery action). Portuguese first-class, English mirrored.
- [ ] Vitest: entry-point gating matrix (feature flags off / design exists / reels /
  locked status / video media → hidden); dialog error mapping; held banner variants.
  Grep existing `PostMediaGallery`/drawer tests for prop-shape breakage.

### Task 7 — Gates

- [ ] `npm run test` (vitest), `npm run test:functions` (Deno), `npm run build` (tsc),
  `npm run lint`, `npx prettier --write` on touched files, `npm test` in
  `services/estudio-render` (manual — not in CI). Root `deno.lock` clean.

### Task 8 — Prod rollout + live E2E + docs (branch `feat/estudio-image-import` off main)

- [ ] Pre-deploy order: (1) Eduardo applies the migration (Task 1 STOP); (2) doc-service
  Vercel deploy (Task 2, additive); (3) edge deploys: `design-import` (new,
  `--no-verify-jwt`), then the Task 5 redeploy list. CRM ships with the PR merge (Vercel).
- [ ] Live E2E on prod, DK TESTE workspace only (feature_estudio + feature_ai_images are
  dark on all plans; DK TESTE has both + 20/mo quota). Create a DISPOSABLE post with a
  text-heavy test image (never a real client post):
  1. Drawer → image tile → "Tornar editável" → confirm → lands in `/estudio/{id}`.
  2. Design is attached + held: gallery locked with the held banner, post media rows
     UNCHANGED (origin still 'upload'), Estúdio home shows the render thumbnail, quota
     ticked by exactly 1 (failed attempts must consume none — see ledger).
  3. Editor: background is text-free, text layers match the source (position/size
     roughly, content exactly), fonts render (Inter), frames clip.
  4. Edit something → save → hold released: post media replaced (origin='design', count
     = frame count), tipo consistent, `media_apply_held=false`.
  5. Carrossel case: 2-image post → 2 frames, clicked frame has text layers, sibling is a
     plain image page, order preserved.
  6. Negative: second import on the same post → `post_already_designed`; import on a
     `stories`/locked post → entry hidden.
  7. Retry semantics: (only if a natural failure occurs) re-running the import replays
     the background without new quota spend.
  8. Delete ALL residue (designs, posts, generated files if surfaced in Arquivos).
- [ ] PR to main with E2E evidence; Eduardo merges.
- [ ] Docs/memory: append slice C outcome + gotchas to
  `project_estudio_openpencil_pivot.md`; note follow-ups (below) in the backlog memory.

## Error taxonomy (design-import)

| code | status | source |
|---|---|---|
| `feature_disabled` (+feature) | 403 | either flag off |
| `post_not_editable` / `post_not_found` / `post_tipo_unsupported` / `post_has_video` / `post_already_designed` | 403/404/422/422/409 | eligibility (mirrors design-manage) |
| `invalid_reference` | 400 | file not image / not in conta / not linked to post |
| `quota_exhausted` / `rate_limited` / `generation_in_progress` / `safety_refusal` / `provider_*` / `storage_*` | as generate-image | inpaint via `generateImageCore` |
| `vision_failed` / `vision_unavailable` | 502 | vision pass |
| `compose_failed` / `doc_too_large` | 502 / 413 | doc service |

## Out of scope (recorded follow-ups)

- MCP `import_image_as_design` (spec: after slice C — rides this exact pipeline).
- Reels cover import (video thumbnail → 9:16 design).
- Panorama-split helper ("dividir arte panorâmica em N páginas") — natural companion,
  reuses compose.
- Arquivos/home entry points for import (spec: "can come later").
- Gemini-direct fallback for the vision pass.
