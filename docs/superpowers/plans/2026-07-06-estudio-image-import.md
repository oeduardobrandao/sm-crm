# Estúdio slice C — image → editable design ("Tornar editável") — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps
> use checkbox (`- [ ]`) syntax for tracking.

> **Revision 2 (2026-07-06):** incorporates external review — link_id instead of file_id
> (the UI never sees files.id), geometry normalized ONCE before vision+inpaint, sequential
> vision→inpaint (no spend on vision failure), create_design drop/recreate (overload trap),
> held = DORMANT attachment (no lock, no publish block — fixes the unconfirmable-hold
> deadlock), save_design_blob queues orphaned manifest JPEGs (pre-existing leak), Vercel
> runtime config for the new endpoints, vision slug corrected to
> `google/gemini-3.1-flash-lite` (verified against the live catalog 2026-07-06).

**Goal:** A raw image already uploaded to a post becomes an editable Estúdio design in one
click (spec: `docs/superpowers/specs/2026-07-04-estudio-design-first-model.md` §"Image →
editable design"). Pipeline: the source is normalized to its target frame geometry, a
vision pass extracts the text blocks, an image-edit pass reconstructs a clean text-free
background (1 unit of the AI-image quota), and the doc service composes a fresh `.fig`
(background image fill + editable text layers). The design is created **attached but
held**: post media is NOT replaced until the user's first save in the editor — they
confirm fidelity before the design takes over the post.

**Architecture:** One new edge function `design-import` (Bearer JWT verified in-app,
`verify_jwt = false`, same as design-manage) orchestrates sequentially: eligibility →
normalize (doc service cover-crops the source to the preset — one geometry for every
later step) → vision → inpaint → compose → `create_design` RPC with a new media-hold
flag → render kick. The inpaint rides the existing `generateImageCore` (quota/ledger/
burst/idempotency/R2 untouched — the import is just another caller). The doc service
grows `POST /api/normalize` and `POST /api/compose` (fresh-graph build — the proven-safe
headless path; no read-modify-write). The hold is a new `designs.media_apply_held`
column: while held the design is a DORMANT attachment — `finalize_design_render` stores
the manifest instead of applying media, the publish gate ignores it, the gallery does not
lock; `save_design_blob` clears it on the first user save.

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
3. **Request identifies the media by `link_id`** (= `post_file_links.id` — the `id` the
   CRM's `PostMedia` actually carries; `files.id` is never exposed to the UI). The edge
   function resolves link → file server-side (image kind, same conta, linked to THIS post
   — one query, uniform `invalid_reference` on any mismatch). No post-media-manage change.
4. **Hold mechanism = `designs.media_apply_held boolean NOT NULL DEFAULT false`, and a
   held design is a DORMANT attachment** — it owns nothing until confirmed:
   - `create_design` gains `p_media_hold boolean DEFAULT false` (only meaningful when
     created attached; forced false when `p_post_id IS NULL`). **Signature change = DROP
     FUNCTION with the exact current 9-arg identity + CREATE the 10-arg version + re-apply
     REVOKE/GRANT** — `CREATE OR REPLACE` with a new defaulted param would create an
     overload and make the existing 9-arg RPC call ambiguous ("function is not unique").
   - `finalize_design_render`: `v_apply_media := <attached+editable> AND NOT
     media_apply_held` (flag read under the same row lock). While held the manifest is
     stored on the row (same branch as unattached) → gallery/home thumbnails work, post
     media untouched.
   - `save_design_blob` clears the hold (first save — including the editor's autosave
     after the first edit — is the fidelity confirmation; the composed doc has
     `clipsContent: true` everywhere so boot normalization never dirties it unprompted).
   - `attach_design` / `detach_design` clear the hold (explicit attach = user intent; a
     detached design is an ordinary design again).
   - **Publish gate treats held as ready** (the post still shows its ORIGINAL media — that
     is exactly what publishing should ship). This kills the deadlock: if the post gets
     locked (approved/scheduled/published) while held, nothing is blocked — the editor
     opens read-only with a held-specific banner + the existing "Duplicar" CTA as the
     recovery path, and the dormant design stays harmless.
   - **Gallery does NOT lock while held** (ownership starts at confirmation): the drawer
     passes the owning design to `PostMediaGallery` only when `!media_apply_held`, and
     shows an informational held banner instead.
5. **`save_design_blob` must queue the stored manifest's JPEGs for deletion** when it
   nulls `render_manifest` (insert each `r2_key` into `file_deletions`, exactly like
   `claim_design_render` does). Today save nulls the manifest before the claim can enqueue
   it — a pre-existing R2 leak for unattached designs that held designs would hit on every
   confirmation. Fixing it in this migration covers both.
6. **Geometry is normalized ONCE, up front.** New doc-service `POST /api/normalize`:
   presigned source URL + preset → cover-cropped JPEG at the preset's exact pixel size
   (CanvasKit). That single cropped image feeds BOTH the vision pass and the inpaint
   reference, so extracted bboxes, the reconstructed background, and the composed frame
   all share one coordinate space — no bbox transforms, no landscape misalignment.
   `generateImageCore` gains an additive `rawReferences?: Array<{bytes, mime}>` input
   (appended after resolved `referenceFileIds`; unit-tested) so the edge function can pass
   the cropped bytes without minting a files row.
7. **Compose input = presigned R2 GET URLs + the inpainted background's URL** (plain
   JSON, no MDF1). Compose fetches images IN PARALLEL (20s per-image timeout), CanvasKit
   downscale/cover-crops each sibling to the preset size, embeds as JPEG (~85) — exports
   happen at preset size anyway, and a 10-frame carrossel stays far under the 10MB blob
   ceiling (`MAX_BLOB_BYTES`).
8. **Frame preset from the clicked image's aspect** (nearest of 1:1 / 4:5 / 9:16). ALL
   frames share that preset (`classifyFrames` rejects mixed aspects); siblings cover-crop
   into it (`scaleMode FILL`).
9. **Pipeline is SEQUENTIAL: normalize → vision → inpaint → compose.** Vision failing must
   not spend quota, so it runs BEFORE the inpaint (it's the cheap fast step, ~5–10s).
   Failures before the inpaint consume nothing; a failure AFTER the inpaint (compose,
   create) retains the spend, but the stable idempotency key makes the retry replay the
   background for free.
10. **Vision pass is not quota-counted** (it costs ~cents; the inpaint is the spend). It
    IS burst-guarded by its own conta rate-limit key (`imgimport:conta:` 20/h) so a loop
    can't hammer OpenRouter.
11. **Inpaint idempotency key = `design-import:file:{file_id}`** (the resolved files.id).
    Stable across retries. Fixed PT prompt (remove ALL text/typography, reconstruct the
    background naturally, change nothing else), `placement: 'background'` (2K),
    `rawReferences: [cropped bytes]`, aspect = the chosen preset's ratio.
12. **Vision model: `google/gemini-3.1-flash-lite`** — verified against the live
    OpenRouter catalog 2026-07-06: text+image input, `structured_outputs`/`response_format`
    supported (`google/gemini-3.1-flash` does NOT exist). Structured output: strict JSON
    via `response_format` with a tolerant first-JSON-block fallback parser, then validate
    hard: text blocks `{text, bbox: {x,y,w,h} normalized 0–1 in CROPPED-image space, size
    (fraction of image height), weight 400|700, color: #rrggbb, align:
    left|center|right}`; drop invalid blocks; cap 20; fontFamily is ALWAYS Inter (the only
    family both the editor embed and the render service resolve for sure); clamp weight
    to 400|700.
13. **MCP `import_image_as_design` is OUT of this slice** (spec: "after slice C").
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
- [ ] Rebuild the RPCs **on top of the 20260706000001 bodies** (current source of truth —
  enviado_cliente already in the editable lists):
  - `create_design`: `DROP FUNCTION create_design(uuid, bigint, bigint, text, text, text,
    text, int, uuid);` then CREATE with the added `p_media_hold boolean DEFAULT false`
    (force false when `p_post_id IS NULL`) and **re-apply** `REVOKE ALL ... FROM PUBLIC` +
    `GRANT EXECUTE ... TO service_role` (drop discards grants). NO `CREATE OR REPLACE` —
    it would mint an ambiguous overload.
  - `save_design_blob` (CREATE OR REPLACE — signature unchanged): before setting
    `render_manifest = NULL`, insert every stored manifest entry's `r2_key` into
    `file_deletions` (decision 5); add `media_apply_held = false` to the UPDATE.
  - `attach_design` / `detach_design` (CREATE OR REPLACE) — clear the hold.
  - `finalize_design_render` (CREATE OR REPLACE) — `v_apply_media := ... AND NOT
    v_media_held`; the held branch stores `p_manifest` on the row (route through the
    existing unattached branch).
- [ ] Behavioral validation on throwaway Postgres (same harness as 20260706000001): apply
  base schema + 20260705000001 + 20260706000001 + this file; cases: (1) import-created
  held design renders → manifest stored, post media rows untouched, `is_stale=false`;
  (2) first `save_design_blob` clears hold AND queues the old manifest's r2_keys into
  `file_deletions` → next finalize applies media + tipo-sync; (3) attach/detach clear the
  hold; (4) `create_design` called WITHOUT `p_media_hold` works (default false) and
  `pg_proc` holds exactly ONE `create_design` (no overload); (5) held + non-editable post
  status → finalize stores manifest only (no exception); (6) unattached design save also
  queues its manifest keys (leak regression).
- [ ] STOP: Eduardo applies to prod via SQL editor (record version). Additive + defaulted
  — old deployed functions are unaffected pre-deploy (design-manage's 9-arg RPC call
  resolves against the single new function via the default).

### Task 2 — Doc service: `POST /api/normalize` + `POST /api/compose`

Same bearer auth (`authorized(req)`), plain JSON bodies.

- [ ] `api/normalize.mjs` + `lib/normalize.js` — `{image: {url, mime}, preset}` → fetch
  (20s timeout), CanvasKit decode → cover-crop/scale to the preset's exact pixel size →
  JPEG (~90) → `image/jpeg` bytes response. Coded 422s: `image_fetch_failed`,
  `image_decode_failed`.
- [ ] `api/compose.mjs` + `lib/compose.js` — input:

  ```
  { preset: '1:1'|'4:5'|'9:16',
    frames: [ { name: '1', image: { url, mime } } , ... ],   // post sort_order order
    texts:  [ { frame: 0, text, bbox:{x,y,w,h}, size, weight, color, align } ] }
  ```

  - Fresh graph via `@open-pencil/core` (page → one FRAME per entry at the preset's pixel
    size, `clipsContent: true`, numeric names) — mirror the starter-build approach in
    `scripts/estudio/build-starter-figs.mjs` for graph/image APIs (image registration =
    whatever the fork's editor image-import uses; spike proof 3 established the headless
    path).
  - Fetch ALL frame images in parallel (20s per-image timeout, reject non-2xx); CanvasKit
    decode → downscale/cover-crop to preset dims → JPEG re-encode → register in
    `graph.images` → background rect/frame fill `scaleMode FILL`. (The clicked frame's
    image is the inpainted background — already preset-sized; the re-encode is a no-op
    crop.)
  - Text nodes on their target frame: bbox×frame-dims → x/y/width/height (bboxes are in
    cropped/preset space — no transform), `fontSize = size × frame height` (clamp
    12–200), Inter + weight, solid color fill, alignment.
  - `ensureExportSafeGuids(graph)` → `io.writeDocument('fig')` → return bytes; enforce
    output ≤ `MAX_BLOB_BYTES` (`doc_too_large` DocError otherwise). Coded 422s:
    `invalid_compose_spec`, `image_fetch_failed`, `doc_too_large`.
- [ ] `vercel.json`: add entries for BOTH new functions — `memory: 1769`,
  `maxDuration: 60`, and the same `includeFiles` (CanvasKit WASM + assets) as
  `api/render.mjs` (they rasterize; without the WASM include they fail only in prod).
- [ ] Tests `test/normalize.test.js` + `test/compose.test.js` (mock fetch with fixture
  image bytes): normalize output dims == preset; compose frame count and preset dims in
  the `describeDocument` projection; text nodes present with mapped bounds/style; image
  fills registered; round-trips through `renderDocument` producing N JPEGs (render smoke
  = the parity gate); rejects bad specs with coded errors.
- [ ] Extend `_shared/doc-service.ts` client with `normalize(spec)` (30s timeout) and
  `compose(spec)` (55s timeout — images fetch in parallel server-side, so N frames don't
  stack) + Deno tests.
- [ ] Deploy to Vercel prod (additive endpoints, safe to ship before the edge function).

### Task 3 — Vision module `_shared/image-gen/vision.ts`

- [ ] `extractTextBlocks({imageBytes, mime, apiKey}, signal?)` → validated block list per
  decision 12 (input = the NORMALIZED/cropped image). OpenRouter chat completions, model
  `google/gemini-3.1-flash-lite`, 60s timeout, ONE retry on 429/5xx/timeout (mirror
  `openrouter.ts` conventions: raw payloads logged internally, typed errors only).
  Moderation-style 403 → `vision_failed` (nothing was generated). Empty result (image has
  no text) is VALID → `[]` (import proceeds: background reconstruction may still be worth
  it, e.g. a logo-only image; the compose simply has no text layers for that frame).
- [ ] Key resolution: reuse the resolved OpenRouter key (`OPEN_ROUTER_API_KEY` ??
  `OPENROUTER_API_KEY`); expose a small `resolveVisionConfig()` beside
  `resolveImageProvider()` so both entrypoints (future MCP tool) can't drift. No
  OpenRouter key → `vision_unavailable` (Gemini fallback for vision is a follow-up; the
  import REQUIRES OpenRouter for now — prod has the key).
- [ ] `generateImageCore`: additive `rawReferences?: Array<{bytes, mime}>` on
  `ImageGenInput`, appended after resolved `referenceFileIds` (unit-tested; existing
  callers unaffected).
- [ ] Deno tests with mocked fetch: happy path, tolerant JSON extraction, invalid-block
  dropping, cap at 20, retry-then-fail, no-key error.

### Task 4 — Edge function `design-import`

`supabase/functions/design-import/{handler.ts,index.ts}` (deps-injected handler; index
wires the same concrete deps design-manage/generate-image use). `config.toml`:
`verify_jwt = false`.

- [ ] `POST /` body `{post_id, link_id}`. SEQUENTIAL order of operations:
  1. CORS/OPTIONS → auth (getUser/getProfile) → `feature_estudio` AND `feature_ai_images`
     (coded `feature_disabled` + which feature).
  2. Eligibility (mirror design-manage create-attached, same coded errors): post in conta;
     tipo `feed|carrossel` (`post_tipo_unsupported` — reels included here for v1); status
     editable incl. enviado_cliente (`post_not_editable`); no video media (`post_has_video`);
     no design attached (`post_already_designed`, pre-check — the RPC re-checks
     transactionally).
  3. Resolve `link_id` → the linked files row: must be kind `image`, in this conta, and
     linked to THIS post (`invalid_reference` otherwise — uniform message, never reveal
     foreign existence). Load all image media links of the post (sort_order order) —
     these are the frames; the resolved file is the clicked one.
  4. Burst gate `imgimport:conta:{conta_id}` 20/h.
  5. Normalize: presign the clicked file's `r2_key` → `docService.normalize({url, preset})`
     → cropped bytes (held in memory, ~200–600KB).
  6. Vision on the cropped bytes (`vision_failed`/`vision_unavailable` abort HERE — before
     any spend).
  7. Inpaint via `generateImageCore` (decision 11 — its own gates/ledger/quota run inside;
     `quota_exhausted`/`rate_limited`/`safety_refusal` from the core map straight out;
     `rawReferences: [cropped]`).
  8. Compose: presign the background file's `r2_key` (from the core's output `file_id`) +
     every sibling image's `r2_key` → `docService.compose(spec)` (clicked frame gets the
     background URL + the text blocks; siblings get their original URLs, no texts).
  9. `putBlob` composed bytes (`designs/{conta}/{uuid}-r1.fig`) → `create_design` RPC with
     `p_media_hold = true` (name: `Import — {post title|id}`) → audit
     (`estudio.import_image`, metadata: post_id, link_id, file_id, background_file_id,
     frame_count, text_block_count, model, cost_usd_estimate — NEVER the extracted text
     content) → `fireRender` (waitUntil, fire-and-forget) → `201 {design_id, quota}`.
  - Failure envelope: `{error: {code, message(PT), retryable}}` (§8 style, statuses via
    the generate-image mapping + `vision_failed`/`vision_unavailable`/`normalize_failed`/
    `compose_failed` → 502, eligibility codes → 403/404/409/422 as in design-manage). On
    failure AFTER the inpaint succeeded: the background file row stays (a normal AI-gen
    asset; the idempotency key makes the retry free) — log, don't try to unwind quota.
- [ ] Deno tests (`supabase/functions/__tests__/design-import.test.ts`, fully mocked
  deps): gate order (feature → eligibility → burst → normalize → vision → spend: assert
  NO provider call when vision or anything earlier fails); reels rejected;
  enviado_cliente accepted; foreign/mismatched link uniform error; carrossel builds N
  frames with clicked-frame texts only; hold flag passed to RPC; audit has no text
  content; §8 envelope mapping; render kicked with rev 1.

### Task 5 — Publish gate: held designs are dormant (ready, not blocking)

- [ ] `_shared/instagram-publish-utils.ts` `designReadiness`: select `media_apply_held`;
  **held → `ready: true`** (the design does not own media yet — the post publishes its
  original media; freshness only matters once confirmed). Non-held logic unchanged.
- [ ] Grep both test suites for `designReadiness`/readiness fixtures and update; add the
  held-is-ready case (post with held design schedules/publishes like a design-less post).
- [ ] Redeploy list for this shared change (record in the deploy task): `instagram-publish`
  (NO `--no-verify-jwt`), `hub-approve`, `instagram-publish-cron`, `design-manage`.

### Task 6 — CRM: entry point, confirm dialog, held-state surfacing

- [ ] `store/designs.ts`: add `media_apply_held` to `DesignSummary` + `DESIGN_COLUMNS`;
  new `importDesignFromMedia(postId, linkId): Promise<{design_id}>` calling
  `functions/v1/design-import` (parse the `{error:{code}}` envelope; throw the code).
- [ ] `PostMediaGallery`: new optional prop `onMakeEditable?: (media: PostMedia) => void`.
  When present, image tiles (`kind === 'image'`, `origin !== 'design'`) get a hover action
  (Wand2 icon, `title` from i18n) beside set-cover — **shown only when NO media item is a
  video** (the gallery owns the media list; this mirrors the server's `post_has_video`
  check, which the caller cannot see).
- [ ] `WorkflowDrawer`: pass `onMakeEditable` only when: `!estudioBlocked` AND
  `features.feature_ai_images !== false` (fail-open, same pattern) AND
  `designSummary === null` AND `post.tipo` in feed|carrossel AND
  `POST_EDITABLE_STATUSES.includes(post.status)`. Handler opens the confirm dialog.
  **Held ≠ ownership:** pass the design to `PostMediaGallery` only when
  `!designSummary.media_apply_held` (held → gallery stays unlocked, decision 4); when
  held, the drawer renders an informational banner instead: "Design importado aguardando
  confirmação — abra no Estúdio e salve para que ele substitua as mídias."
- [ ] `ImportToEstudioDialog` (new, `pages/estudio/`): shadcn AlertDialog — explains what
  happens (texts become editable layers, background reconstructed by AI, **consumes 1
  image of the monthly AI quota**; carrossel: "as N imagens do post viram páginas do
  design"), long-running state (spinner + "pode levar até dois minutos"), error mapping to
  PT (`quota_exhausted`, `rate_limited`, `safety_refusal`, `post_*` codes, generic). On
  success: invalidate `['post-design-summary', postId]` + navigate(`/estudio/${design_id}`).
- [ ] `EstudioPage` (shell) held banners:
  - Editable post + held: slim banner (reuse the read-only banner slot/pattern):
    "Confira a fidelidade do design — ao salvar, ele substitui as mídias do post."
  - **Locked post + held** (readOnly already true via `EDITABLE_STATUSES`): held-specific
    read-only text — the design never replaced the post's media and the post is locked;
    "Duplicar" (existing CTA) is the way to reuse it. No dead-end messaging that implies
    waiting or saving will fix it.
- [ ] i18n: new keys in `packages/i18n/locales/{pt,en}/estudio.json` (+`posts.json` for
  the gallery action). Portuguese first-class, English mirrored.
- [ ] Vitest: entry-point gating matrix (feature flags off / design exists / reels /
  locked status → no `onMakeEditable`; video media present → gallery hides the action);
  dialog error mapping; held banner variants (drawer info banner, shell editable-held,
  shell locked-held); gallery NOT locked when held. Grep existing
  `PostMediaGallery`/drawer tests for prop-shape breakage.

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
  2. Design is attached + held: gallery UNLOCKED with the held info banner, post media
     rows UNCHANGED (origin still 'upload'), Estúdio home shows the render thumbnail,
     quota ticked by exactly 1. Failures BEFORE the inpaint (eligibility/vision) must
     consume none — check the ledger; a failure after the inpaint retains the spend and
     a retry must NOT tick the quota again (idempotent replay).
  3. Editor: background is text-free, text layers match the source (position/size
     roughly, content exactly), fonts render (Inter), frames clip. Also verify a
     NON-PRESET-aspect source (e.g. landscape photo): text sits on the same spot of the
     cropped background (decision 6).
  4. Edit something → save → hold released: post media replaced (origin='design', count
     = frame count), tipo consistent, `media_apply_held=false`, and the PREVIOUS held
     render's JPEG keys landed in `file_deletions` (decision 5).
  5. Carrossel case: 2-image post → 2 frames, clicked frame has text layers, sibling is a
     plain image page, order preserved.
  6. Negative: second import on the same post → `post_already_designed`; import on a
     `stories`/locked post → entry hidden; post with a video → action hidden.
  7. Held-dormant: schedule-validation on a held-design post does NOT complain about the
     design (Task 5).
  8. Delete ALL residue (designs, posts, generated files if surfaced in Arquivos).
- [ ] PR to main with E2E evidence; Eduardo merges.
- [ ] Docs/memory: append slice C outcome + gotchas to
  `project_estudio_openpencil_pivot.md`; note follow-ups (below) in the backlog memory.

## Error taxonomy (design-import)

| code | status | source |
|---|---|---|
| `feature_disabled` (+feature) | 403 | either flag off |
| `post_not_editable` / `post_not_found` / `post_tipo_unsupported` / `post_has_video` / `post_already_designed` | 403/404/422/422/409 | eligibility (mirrors design-manage) |
| `invalid_reference` | 400 | link not image / not in conta / not linked to post |
| `quota_exhausted` / `rate_limited` / `generation_in_progress` / `safety_refusal` / `provider_*` / `storage_*` | as generate-image | inpaint via `generateImageCore` |
| `vision_failed` / `vision_unavailable` | 502 | vision pass (before any spend) |
| `normalize_failed` / `compose_failed` / `doc_too_large` | 502 / 502 / 413 | doc service |

## Out of scope (recorded follow-ups)

- MCP `import_image_as_design` (spec: after slice C — rides this exact pipeline).
- Reels cover import (video thumbnail → 9:16 design).
- Panorama-split helper ("dividir arte panorâmica em N páginas") — natural companion,
  reuses compose.
- Arquivos/home entry points for import (spec: "can come later").
- Gemini-direct fallback for the vision pass.
- Detach action in the Estúdio home card menu (recovery convenience for dormant designs;
  API exists, UI doesn't expose it yet).
