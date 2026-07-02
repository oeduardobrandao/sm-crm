# Estúdio — Implementation Plan (v1)

Status: **draft for approval** · 2026-07-02 · branch `feat/estudio-post-editor`
Companion to [estudio-design.md](estudio-design.md) (as amended 2026-07-02 — tree-builder split, tipo sync in PUT, brand-logo route, no post_file_links from generate_image, correcao auto-move on update_design).
Produced by a 7-drafter + 1-verifier workflow (`wf_cdaebfe4-abc`); all verifier blockers/majors are resolved in this document. Repo citations were spot-verified by the verifier.

---

## 0. How to execute

- Slices run **in order 1 → 7**; inside a slice, PRs run in the listed order. Every PR branches off `main` (`feat/estudio-s<slice>-<short-name>`), stays green behind `feature_estudio=false`, and passes the full gate before push:
  `npm run format && npm run lint && npm run test && deno test supabase/functions/` — and after any deno run: `git checkout deno.lock && npm ci`.
- Migrations apply via SQL editor per design §4.4 (both envs; record versions in `supabase_migrations.schema_migrations`). Prod migrations are deferred to the slice-1 exit; **the cron-schedule migration (000004) applies only AFTER its function is deployed** (pg_cron HTTP failures are silent).
- Edge deploys: `--use-api`; `--no-verify-jwt` only for `design-render`, `design-render-sweep-cron` (and existing self-auth fns on redeploy).
- The `_shared/` modules created here sit outside the prettier/eslint globs — format them manually with the repo config.

### PR map (19 PRs)

| Slice | PR | Scope |
|---|---|---|
| 1 | 1.1 | Migrations 000001–000003 + entitlements arrays + all 6 admin/CRM mirrors |
| 1 | 1.2 | `_shared/design-doc.ts` schema + fixtures + dual-runtime tests + zod@4 mapping + alias triple |
| 1 | 1.3 | Fonts pipeline: build script, manifest/keys/types/match, public assets, R2 upload, `@mesaas/fonts` alias |
| 1 | 1.4 | R2 byte helpers + `design-render-tree` (pure, aliased) + `design-render-core` (wasm) + `design-render` fn (single page) |
| 1 | 1.5 | Render chaining + sweep cron + migration 000004 |
| 1 | 1.6 | `post-design-manage` fn (GET/PUT/DELETE, tipo sync) + staging rollout + seeded-doc DoD + R1 load test |
| 2 | 2.A | Deps, route/nav/i18n, doc-state core, picker + entry flow (+ T2.5 measurement spike runs FIRST) |
| 2 | 2.B1 | Browser satori renderer + font loading + measurement cache + zoom/pan |
| 2 | 2.B2 | Selection/drag/resize + snapping + IG safe-zone guides |
| 2 | 2.C | ContextualToolbar + TipTap text overlay + image insert paths + SlideStrip |
| 2 | 2.D | Autosave + conflict banner + stash + **parity fixture** + integration tests |
| 3 | 3.A | Logo materialization (`POST post-design-manage/brand-logo`, SSRF-hardened) |
| 3 | 3.B | FontPicker + ColorPicker + BrandPanel + HubTab BrandEditor upgrade |
| 4 | 4.A | Edge: design-readiness gate in `validateForScheduling` + publish-cron re-check + stale re-trigger |
| 4 | 4.B | CRM: `store/postDesigns.ts`, "Abrir no Estúdio", PostMediaGallery ownership mode |
| 5 | 5.A | Scopes + `mcp/design.ts` glue + `get/create/update_design` + render trigger + tests |
| 5 | 5.B | `_shared/image-gen/*` + `generate_image` tool + quota tests + CLAUDE.md env docs |
| 5 | 5.C | `preview_design` + `get_design_capabilities` + agent guidance |
| 6 | 6.A | `generate-image` edge entrypoint + deno tests |
| 6 | 6.B | CRM: service/mutation + Gerar imagem panel + quota meter + insert flow |
| 7 | 7.A | Rotation handles + align ops + keyboard shortcuts |
| 7 | 7.B | LayerListPanel (create) + guias persistence + template `instantiateDoc` op |

---

## 1. Resolved decisions (verifier findings + drafter flags — rulings baked into the tasks below)

1. **Tree builder is mandatory and shared** (verifier B2): `_shared/design-render-tree.ts` is runtime-neutral (no wasm/Deno imports), aliased as `@mesaas/design-render-tree`; `design-render-core.ts` wraps it with the wasm stack; the editor's `satoriEngine.ts` is thin browser glue over the same module. One tree implementation, ever.
2. **Parity fixture owned by slice 2 PR-D** (B1): the T1.4 golden doc renders through browser-satori (vitest) and edge-satori (deno) and the SVG strings must be identical.
3. **ContextualToolbar created in slice 2 PR-C** (B3): per-layer-type controls (text: font/size/weight/color/align/shadow/pill; image: fit/radius/border/replace; shape: fill/stroke/radius) with stopgap font control; slice 3 swaps in FontPicker.
4. **LayerListPanel created in slice 7** (B4): T7.4 owns the shell + lock + drag z-order. Slice 2 does not ship it.
5. **Format switching syncs `tipo` server-side** (M5): `post-design-manage` PUT is the single writer (design §5.4 amended). The editor changes `doc.format` and saves; no client-side post update.
6. **Single ownership of shared primitives** (M7): `_shared/fonts/match.ts` + its tests → slice 1 PR 1.3; `putObject`/`getObjectBytes` → slice 1 PR 1.4; `useFontManifest` → slice 2 PR 2.B1 (T3.3 folded in). Slices 3/5 consume, never create.
7. **`@mesaas/fonts` alias lands in slice 1 PR 1.3** (M6) alongside the fonts build.
8. **Cron-schedule migration applies after fn deploy** (M8) — staging and prod.
9. **Slice-2 PR-B split in two** (M9): renderer/fonts/measure vs interaction/snap/guides.
10. **Ids**: no nanoid dependency — a ~5-line `crypto.getRandomValues` generator with the spelled-out `abcdefghijklmnopqrstuvwxyz0123456789` alphabet lives in `_shared/design-doc.ts` and is imported everywhere (verifier m14/m15).
11. **`layout` dropped from the editor PUT response** (slice-1 flag 3; design §5.4 amended): measured bboxes ship only on MCP create/update responses; the editor uses its own cache. Keeps wasm out of the save path.
12. **Column grants include `post_id`/`conta_id` on INSERT** (slice-1 flag 1) — required for the user-JWT get-or-create path; RLS still scopes conta.
13. **`generate_image` never creates `post_file_links`** (slice-5 flag 5 / slice-6 flag 3; design §8 amended): `post_id` is ledger metadata only. The MCP tool and CRM entrypoint share this rule via the core.
14. **`generate_image` args include `placement?: 'background'|'element'`** (slice-5 flag 1): quality defaults 2K/1K by placement; explicit `quality` overrides; omitted both → 1K.
15. **All four ARs exposed** incl. 16:9 (slice-5 flag 2).
16. **`update_design` also auto-moves `correcao_cliente`** (slice-5 flag 3; design §9 amended).
17. **`auditArgs(args, result)` extension approved** (slice-5 flag 6) — small `register()` change so generation audits carry file_id/cost without the prompt.
18. **Brand context** (slice-6 flag 1): `client_id` folds `hub_brand` colors + `especialidade` into server-side prompt augmentation; `use_brand_logo` adds the logo as a reference image — per design §8.
19. **Quota meter initial read** = RLS-scoped succeeded-count on `ai_image_generations` (slice-6 flag 2).
20. **Cron re-check policy** (slice-4 flag 1): `pending/rendering` → clear lock + skip (retry next cycle); `failed` → `markFailed` (surfaces `falha_publicacao`). Additionally (verifier m11): the schedule-time gate fire-and-forgets a `design-render` trigger when it blocks on `is_stale`/`failed`, so renders converge while the user sees the message.
21. **v1 acceptances**: safe-zone/guias persistence via user-id-keyed localStorage (device-scoped ok); no `hidden` layer field (lock only); distribute UI deferred with multi-select (pure ops ship); template groundwork = `instantiateDoc` op only; ColorPicker = native input + hex + swatches (no new dep); Hub Marca page keeps showing `logo_url` (uploaded-logo display on Hub is backlog); mixed manual-video carrossels with designs unsupported in v1 (documented); hub-approve silently skipping auto-schedule on a stale design is accepted v1 behavior (backlog: surface a reason).
22. **Client-side validation module dropped** (verifier m13): the editor surfaces server `warnings[]`/`issues[]` from PUT (T2.11); reducer ops enforce structural limits locally.
23. **Nav-gating sequencing** (slice-2 flag 4): `getNavGroups` hides items only on explicit `false`, so PR 2.A must not reach prod before slice 1's entitlements deploy (they're ordered that way; noted as a hard constraint).
24. **Google-side billing alert** (verifier m12): set at ~2× the sum of plan caps during slice 6 staging checklist.
25. **Open product decisions** (design §14) still owned by the user: plan-tier seeds/quotas (needed before enabling flags on any plan — NOT a blocker for merging dark), beta gating, prompt retention.

---

## 2. Slice 1 — Foundations

**DoD:** a seeded 2-page doc saved through `post-design-manage` renders to JPEGs visible in the client Hub on staging; R1 load-test numbers recorded.

### T1.1 — Migrations 000001–000003 (PR 1.1)
- Files: create `supabase/migrations/20260702000001_post_designs.sql`, `..000002_ai_image_generations.sql`, `..000003_plans_estudio_columns.sql` (versions verified free; latest on disk `20260629000002`).
- Steps: 000001 = `post_designs` DDL per design §4.1 + BEFORE trigger (md5 doc_hash, updated_at, **rev bump on doc change**, render_status reset) + RLS member-check/service-bypass (files/folders pattern) + column grants — authenticated INSERT `(post_id, conta_id, doc, doc_version, updated_via, updated_by)`, UPDATE `(doc, doc_version, updated_via, updated_by)` — + SECURITY DEFINER `claim_design_render` (3-min stale-lock) / `finish_design_render` (hash-guarded), service_role-only EXECUTE + `post_file_links.origin` ALTER + `hub_brand.logo_file_id` ALTER. 000002 = ledger DDL + `(conta_id, created_at DESC)` index + RLS (member read, service write) + BEFORE-INSERT `enforce_plan_count_limit('rate_ai_images_per_month','direct','conta_id','conta_id','status = ''succeeded'' AND created_at >= date_trunc(''month'', now())')` (TG_ARGV[4] predicate verified supported). 000003 = plans ALTERs + `rate_ai_images_per_month = 0` backfill + commented seed placeholders explicitly including `lifetime`. All idempotent (must apply cleanly twice).
- Tests: staging idempotency proof (T1.10-equivalent inside PR 1.6); `npm run test:functions` stays green.
- Depends on: —

### T1.2 — Shared schema module + dual-runtime tests (PR 1.2)
- Files: create `supabase/functions/_shared/design-doc.ts`, `_shared/design-doc-fixtures.ts`, `supabase/functions/__tests__/design-doc-schema_test.ts`, `test/design-doc-schema.test.ts`; modify `supabase/functions/deno.json` (`"zod": "npm:zod@4.3.6"`), `apps/crm/vite.config.ts` + `apps/crm/tsconfig.json` + root `vitest.config.ts` (`@mesaas/design-doc` alias triple, i18n precedent).
- Steps: schema per design §2.2/2.3 (`.strict()`, discriminated unions, authoring schema omits `canvas`); Stage 0/1/2 per §2.4 as pure `validateDesignDoc(doc, {tipo, manifest, checkFileIds})` (DB checks injected; ONE batched file query); aggregated `issues[]` capped 20; normalization (canvas injection, defaults, rounding, stop sort, auto-names, **inline id generator** — decision 10); RTL error. Fixtures: valid feed/carrossel-with-runs/reel_cover + rejects (unknown key, bad hex, 11 pages, stories tipo, unknown font, RTL, >256 KB) with expected codes and normalized outputs; both suites assert identical behavior.
- Done when: `npm run test` + `npm run test:functions` pass the identical matrix; `npm run build` resolves the alias.
- Depends on: T1.4 manifest keys (stub the manifest arg until PR 1.3 merges — validation takes it as input).

### T1.3 — Entitlements + the 6 mirrors (PR 1.1, same PR as T1.1)
- Files: `supabase/functions/_shared/entitlements.ts` (RATE_COLUMNS += `rate_ai_images_per_month`; FEATURE_COLUMNS += `feature_estudio`, `feature_ai_images`), `apps/admin/src/lib/api.ts` (Plan iface + FEATURE_FLAG_KEYS/LABELS + RATE_LIMIT_KEYS/LABELS), `apps/admin/src/pages/__tests__/plan-form.test.ts` (makePlan), `supabase/functions/__tests__/platform-admin-plan-mutations_test.ts` (not-silently-dropped assertions), `apps/crm/src/hooks/useWorkspaceLimits.ts` (3 new keys **+ the already-missing `feature_mcp`/`max_mcp_keys`**), `apps/crm/src/components/layout/nav-data.ts` (NAV_FEATURE `estudio` entry — inert until slice 2), `apps/crm/src/lib/entitlement-errors.ts` (PT labels).
- Done when: full gate green; grep shows the 3 keys in all 6 locations.

### T1.4 — Fonts pipeline (PR 1.3)
- Files: create `scripts/fonts/build.mjs`, `scripts/fonts/families.json`, `supabase/functions/_shared/fonts/{manifest.json,keys.ts,types.ts,match.ts,ATTRIBUTION.md}`, `public/fonts/estudio/**` + `fonts.css`, `test/font-match.test.ts`, `scripts/fonts/build.test.mjs`; modify root `package.json` (`fonts:build`, devDep `subset-font@2.5.0`), plus the **`@mesaas/fonts` alias triple** (decision 7).
- Steps: per design §7 — 26 families/50 variants; Fontsource metadata drift-gate; pinned static latin+latin-ext TTFs; preview strips; `fonts.css` with unicode-range + `?v=`; `--upload` to R2 `assets/fonts/v1/` (sha-idempotent); generated keys/types; hand-written pure `match.ts` (exact → alias → unique prefix → Levenshtein ≤2 → null on ambiguity) **owned here with its tests** (decision 6).
- Done when: build idempotent on second run; manifest committed; **latin-ext fallback check**: deno spike renders a latin-ext glyph through satori with two same-name entries and asserts per-glyph fallback — if unreliable, drop latin-ext (documented in families.json).
- Depends on: —

### T1.5 — R2 byte helpers + tree + core + `design-render` single page (PR 1.4)
- Files: modify `supabase/functions/_shared/r2.ts` (`putObject`, `getObjectBytes` — **sole owner**, decision 6); create `_shared/design-render-tree.ts` (**mandatory pure module**, decision 1) + `@mesaas/design-render-tree` alias in the triple; create `_shared/design-render-core.ts`; create `supabase/functions/design-render/{index.ts,handler.ts}` + `__tests__/design-render_test.ts`.
- Steps: tree builder implements the §5.2 render contract (pre-wrap/break-word, runs→spans, per-line run highlights, block pill split on `\n`, bg `<img objectFit>`, rgba overlays, overflow hidden, `{{page}}/{{pages}}`, Twemoji-17.0.3 asset-callback config); core = pinned wasm imports (`npm:satori@0.26.0`, `npm:@resvg/resvg-wasm@2.6.2`, `npm:@jsquash/jpeg@1.6.0/encode.js`), module-scope init, font/emoji LRU byte caches, `renderPage(doc, i, deps, {width?})`, `measureLayer` via resvg getBBox; fn = x-cron-secret, claim RPC, page-0 render, R2 write `contas/{conta_id}/designs/{id}/{rev}/{page_id}.jpg`, `file_insert_with_quota`, single-page finalize (hash re-check → links rewrite `origin='design'` only → finish).
- Tests: golden-doc SVG snapshot (parity precursor); secret rejection; stale-rev 204; claim 409; manual links preserved; is_cover; sanitized failure path.
- Depends on: T1.2, T1.4.

### T1.6 — Chaining + sweep cron (PR 1.5)
- Files: modify `design-render/handler.ts`; create `supabase/functions/design-render-sweep-cron/index.ts`, `supabase/migrations/20260702000004_schedule_design_render_sweep.sql` (vault-view pattern, every 2 min).
- Steps: `page_index` chunks re-read the row (abort 204 on rev/status change); fire-and-forget self-fetch with x-cron-secret; finalize only on last page; sweep re-fires rows stuck >2 min with cron-failure email on error. **Migration applies only after both fns deploy** (decision 8).
- Tests: 3-page fixture chains 3 invocations, finalizes once; mid-chain rev-change abort; sweep selection + secret rejection.
- Depends on: T1.5.

### T1.7 — `post-design-manage` (PR 1.6)
- Files: create `supabase/functions/post-design-manage/{index.ts,handler.ts,starter-doc.ts}` + `__tests__/post-design-manage_test.ts`.
- Steps: per design §5.4 — JWT ON, cors, profile→conta; **writes via a user-JWT client** so RLS + grants enforce (rev is trigger-maintained); GET get-or-create (starter doc from tipo + existing cover); PUT = feature gate → status guard → shared validation → **tipo sync when format changed** (decision 5) → rev-guarded update → render trigger → `{design, rev, warnings}`; DELETE releases ownership; audit without doc contents.
- Tests: tenancy, feature gate, status guard, aggregated issues, `rev_conflict {current_rev}`, tipo-sync write recorded, trigger-failure non-fatal, starter doc, audit redaction.
- Depends on: T1.1, T1.2, T1.5.

### T1.8 — Staging rollout + DoD + R1 (PR 1.6, ops)
- Files: create `scripts/estudio/{seed-design.mjs,load-test-render.mjs}` (env-driven, no committed creds).
- Steps: SQL-editor apply 000001–000003 + record versions → fonts build `--upload` → deploy `design-render`/`sweep-cron` (`--no-verify-jwt`), `post-design-manage`, redeploy `workspace-limits`/`platform-admin` → **then** apply + record 000004 → seed the §2.6 fixture through the API → assert `rendered`/`!is_stale`/2 `origin='design'` links → verify in Hub. R1: p50/p95 across 1080×1350, 1080×1920, and 512-preview (photo-heavy + text-only), recorded on the PR and in design §14 R1.
- Depends on: T1.1–T1.7 merged.

---

## 3. Slice 2 — Editor MVP

### T2.1 — Deps + route/nav/i18n scaffold (PR 2.A)
Root `package.json`: `satori: "0.26.0"` (exact), yoga-wasm-web pinned to satori's dep version (no nanoid — decision 10). `App.tsx` lazy routes `/estudio` + `/estudio/:postId` (parseInt + isNaN guard); nav item `ph-magic-wand` in `gestao` + NAV_FEATURE; `nav.estudio` in pt/en locales; EstudioPage full-bleed internal container. Tests: nav gating hides when flag false. **Must not reach prod before slice 1 entitlements deploy** (decision 23).

### T2.2 — designDocOps + useDesignDocState (PR 2.A)
Pure ops (add/remove/duplicate/move layer, patch props, set format+aspect_ratio recomputing canvas, page CRUD with 1..10 guards and id re-minting via the shared generator) + reducer `{doc, past[], future[], selection, activePage}` (undo cap 50; transient vs commit actions). Primary coverage-ratchet payers.

### T2.3 — PostPicker + entry flow + design query (PR 2.A)
`usePostDesignQuery` → `post-design-manage` GET (get-or-create per §5.4 — no separate client insert); picker cascade; `useEstudioEntryFlow` create-from-scratch verbatim ExpressPostPage pattern (`addWorkflow` → synthetic concluded etapa → `addWorkflowPost` → navigate; abandonment cleanup iff zero layers).

### T2.5 — Text measurement cache — **runs first, inside PR 2.A's window** (verifier m17)
`lib/textMeasure.ts`: single-layer satori render → hidden-DOM bbox; LRU keyed `(content, style-hash, w)`. Timeboxed spike: if bbox proves unreliable, STOP and report (fallback is a slice-1 schema change — advisory heights at normalization; don't improvise).

### T2.4 — Browser satori: renderer, fonts, stage, zoom/pan (PR 2.B1)
`useSatoriRenderer` (dynamic `import('satori/wasm')` + yoga init in the route chunk); `satoriEngine.ts` = thin browser glue over **`@mesaas/design-render-tree`** (decision 1) with signed-URL image resolver (`imageResolution.ts`, TTL cache) and the same Twemoji callback; **`useFontManifest` owned here** (decision 6): manifest via `@mesaas/fonts`, `ensureVariant()` ArrayBuffers from `/fonts/estudio/` shared with `@font-face` (single download per variant); SatoriPreview debounced ~150 ms re-render on commit; `useCanvasTransform` zoom/pan + screen↔canvas math.

### T2.6 — Selection + drag/resize (PR 2.B2)
`layerGeometry.ts` (rotated hit-tests via inverse center-rotation, handle math, measured text heights), `useSelection`, InteractionOverlay + LayerHandles: transient CSS ghost at 60 fps, one commit per gesture; text resizes `w` only; rotation *renders* but handles are slice 7.

### T2.7 — Snapping + safe-zone guides (PR 2.B2)
`snapMath.ts` pure (canvas/sibling edges + centers, threshold ÷ scale); guide lines during gestures; §6.6 safe zones (4:5/1:1 top ~150 px / bottom ~250 px / dots strip; reel_cover center 1080×1440 box), toggle default-on — **persistence lands in slice 7** (decision 21/verifier m16).

### T2.12 — ContextualToolbar (PR 2.C — **new, verifier B3**)
`components/Toolbar/ContextualToolbar.tsx` floating near the selection bbox, variant by layer type: text (stopgap font select from manifest keys, size, weight, color via a basic hex input until slice 3, align, shadow toggle, pill toggle), image (fit/radius/border/replace via FilePicker), shape (fill/stroke/radius). All edits dispatch reducer ops. RTL tests per variant.

### T2.8 — TipTap TextEditOverlay + runs mapping (PR 2.C)
Minimal TipTap (paragraph + hard-break + bold/italic/color/highlight marks) ↔ `Run[]` bidirectional mapping (`runsMapping.ts`, plain `text` when unstyled); overlay positioned/rotated at the layer box with the same font binary; commit blur/Enter, Shift+Enter `\n`, Escape cancels.

### T2.9 — Image insert paths + LeftToolDock (PR 2.C)
Dock (text/shape/image; AI + brand buttons stubbed); upload via `uploadFile({file, folderId: null})` **without postId** (§5.2); paste + drop funnel into the same insert; `FilePickerModal` reuse (`filterKind:['image']`).

### T2.10 — SlideStrip (PR 2.C)
dnd-kit horizontal thumbs (reduced-scale SatoriPreview); reorder/add/duplicate/delete via reducer ops (1..10 guards); hidden for feed/reel_cover; `{{page}}` counters correct after reorder.

### T2.11 — Autosave + conflict + stash (PR 2.D)
800 ms debounced PUT with `expected_rev`; adopt returned normalized doc + rev; save-state pill in TopToolbar; 409 → pause autosave, stash to `localStorage estudio:stash:{postId}`, banner + reload; `design_invalid` issues via sonner; server `warnings[]` surfaced (decision 22); flush-on-unmount.

### T2.13 — Parity fixture (PR 2.D — **new, verifier B1**)
The T1.5 golden doc rendered by browser-satori (vitest) and edge-satori (deno) must produce **byte-identical SVG strings** (same tree module, same font bytes). This is the standing drift alarm for satori/font/emoji version skew; a version bump that breaks it blocks merge until both sides re-pin.

---

## 4. Slice 3 — Brand kit + fonts in the editor

- **T3.1 (PR 3.B)** — matcher consumption only (match.ts + tests are slice 1, decision 6): wire into FontPicker/BrandPanel; spot-check `deno check` importability.
- **T3.2 (PR 3.A)** — logo materialization: `_shared/brand-logo.ts` (`materializeBrandLogo`: idempotent on `logo_file_id`; SSRF-hardened per §4.1 — https-only, DNS-resolved private-range rejection, 10 s timeout, ≤5 MB streamed cap, image/* + magic-byte sniff) + `POST /brand-logo {cliente_id}` route on `post-design-manage` (design §5.4 amended); `HubBrandRow.logo_file_id` type. Full deno test matrix (idempotent, http rejected, private-IP rejected, oversize, non-image sniff, quota failure).
- **T3.4 (PR 3.B)** — FontPicker: Popover+Command; "Marca" pinned via matcher (unmatched = disabled "não incluída no Estúdio" row); 4 vibe groups; preview strips lazily FontFace'd via IntersectionObserver; weight/style limited to manifest variants; replaces T2.12's stopgap.
- **T3.5 (PR 3.B)** — ColorPicker: native color input + validated hex field (+8-digit alpha) + brand swatches + recents; regex from `@mesaas/design-doc`. Used by ContextualToolbar + BrandPanel; placed for cross-page import (HubTab uses it too).
- **T3.6 (PR 3.B)** — BrandPanel: `getHubBrand` query (key parity with HubTab); colors → apply; fonts → apply matched keys; logo → thumbnail + "Inserir logo" (`fit:'contain'` layer) or "Importar logo" (calls T3.2, invalidates query) or empty-state.
- **T3.7 (PR 3.B)** — HubTab BrandEditor upgrade: ColorPicker replaces free-text colors; logo upload (`uploadFile` → `upsertHubBrand({logo_file_id})`, preview via signed URL; `logo_url` left untouched for Hub display — decision 21); fonts stay free-text (matcher consumes raw names).
- ~~T3.3~~ folded into T2.4 (decision 6).

---

## 5. Slice 4 — Lifecycle integration

- **T4.1 (PR 4.A)** — `checkDesignReadiness(db, postId)` in `_shared/instagram-publish-utils.ts` (null row → ready; else `rendered && !is_stale`), called inside `validateForScheduling` with distinct PT messages for pending/failed; **fire-and-forget render re-trigger when blocking on stale/failed** (decision 20). Hub-approve inherits via redeploy — zero Hub-app changes (verified: `hub-posts` selects explicit columns; `origin` invisible). All three existing publish-validation test files must seed `post_designs` select queues (mock default `[]` is truthy — verified trap).
- **T4.2 (PR 4.A)** — publish-cron container-phase re-check: pending/rendering → clear lock + skip; failed → throw → `markFailed` (decision 20).
- **T4.3 (PR 4.B)** — `store/postDesigns.ts`: `getPostDesignSummary` via direct RLS select `.maybeSingle()` (**never** the GET route — get-or-create would mint rows from an existence check); `PostMedia.origin` type addition; barrel export.
- **T4.4 (PR 4.B)** — `OpenInEstudioButton` (feature-gated, hidden for stories, lucide icon) inserted above PostMediaGallery in WorkflowDrawer (verified line 1154); expanded-only summary query.
- **T4.5 (PR 4.B)** — PostMediaGallery ownership mode via new optional props (`design`, `postTipo`): feed/carrossel + design → banner + disabled media editing; reels + design → cover-only ownership (video uploads still allowed, image files rejected, `origin='design'` tiles uncontrollable, "Definir como capa" hidden). Existing callers unchanged.

---

## 6. Slice 5 — MCP tools

- **T5.1 (PR 5.A)** — scopes `designs:write` + `images:generate` in `MCP_ALLOWED_SCOPES` + `mcp-scopes.ts` labels + the three test suites; `MCP_AGENT_PRESET` unchanged.
- **T5.2 (PR 5.A)** — `mcp/design.ts` glue: zod4 pipeline import; `DesignValidationError` (issues ≤20, truncated flag); `errorResult` branch emitting the §2.4 shape; foreign-vs-missing file uniform message.
- **T5.3 (PR 5.A)** — `get_design` / `create_design` / `update_design` per amended §9: EDITABLE_STATUSES export; existing-design structured error; rev-guarded update (+ omitted rev = LWW); correcao auto-move on **both** writes (decision 16); measure-pass `layout` via render core; injectable `triggerRender` (fire-and-forget, precedent instagram-analytics); audit `{post_id, format, page_count, layer_count, doc_bytes, rev}`.
- **T5.4 (PR 5.B)** — `_shared/image-gen/{provider,gemini,core}.ts` per §8 (+ `parsePngIhdr`; `putObject` consumed from slice 1); tool `generate_image` with `placement` arg (decision 14), 4 ARs (decision 15), brand context (decision 18), `post_id` → ledger only (decision 13); `auditArgs(args, result)` extension (decision 17); `GEMINI_API_KEY` in CLAUDE.md. Test matrix: gates short-circuit before provider spend; pending-before-provider ordering; safety/timeout ledger statuses don't count quota; storage-quota → R2 delete; IHDR dims win; prompt only ever in the ledger insert.
- **T5.5 (PR 5.C)** — `preview_design` (ONE page/call, width 512 default, MCP image content block via `imageResult` helper) + `get_design_capabilities` (formats/mapping/fonts/limits/features/quota; per-client brand block with matcher + slice-3 logo materializer; `get_brand_profile` untouched).
- **T5.6 (PR 5.C — new, verifier m10)** — agent guidance: rich PT tool descriptions in the existing style + `docs/estudio-mcp-guide.md` (authoring conventions §2.1, capability discovery → create → preview → iterate loop, error-recovery walkthrough with a real `issues[]` example).

---

## 7. Slice 6 — In-editor AI generation

- **T6.1 (PR 6.A)** — `generate-image` fn: file-upload-finalize split pattern, JWT ON, delegates the whole pipeline to the slice-5 core (`source:'crm'`; **no double-enforcement** of gates — the core owns them); §8 failure envelope; audit without prompt. Staging checklist includes the Google billing alert (decision 24). Deploy: `--use-api`, JWT ON.
- **T6.2 (PR 6.A)** — deno test matrix (fake provider; mirrors ideia-media-manage harness): 401, cors, feature/quota/burst short-circuits, ledger lifecycle, safety refusal, storage-quota R2 delete, zero `post_file_links` even with `post_id`, no prompt in audit.
- **T6.3 (PR 6.B)** — `services/imageGen.ts` (callFn convention; throws parsed envelope); `mapEntitlementError` extension (`feature_disabled` → feature toast, `quota_exhausted` → limit toast; other codes → in-panel PT copy); `useGenerateImageMutation`.
- **T6.4 (PR 6.B)** — `GerarImagemPanel` per the approved visual spec (prompt ≤2000, AR chips defaulting to canvas AR, placement `fundo|camada` keying 2K/1K, brand toggle, quota meter via `useAiImageQuota` — RLS count + response refresh); insert flow: "Inserir como camada" (centered ≤80% canvas ImageLayer) / "Usar como fundo" (preserves existing overlay); `imageResolution` cache seeded with `preview_url`; one undo step each.

---

## 8. Slice 7 — Polish

- **T7.1 (PR 7.A)** — rotation handles: `angleFromPointer`/`normalizeAngle`/`snapAngle` (Shift → 45° stops) pure + grip UI + transient angle badge; one commit per gesture; round-trip tests at 0/33/90/359.
- **T7.2 (PR 7.A)** — align-to-canvas ops (rotated AABB via corners; text via measured-bbox arg) + ContextualToolbar buttons; `distributeLayers` ships as pure op only (UI blocked on multi-select, decision 21).
- **T7.3 (PR 7.A)** — `useEditorShortcuts`: Delete (respects lock), arrows 1 px / Shift 10 px (burst-coalesced undo), Cmd/Ctrl+Z / Shift+Cmd+Z / Ctrl+Y, Cmd/Ctrl+D duplicate (+20/+20, fresh ids, auto-name), Escape deselect; inert while inputs/TipTap focused.
- **T7.4 (PR 7.B)** — **create** `LayerListPanel` (decision 4): topmost-first rows (name, type icon, lock toggle), dnd-kit reorder → `moveLayer`, lock enforced in overlay hit-testing (panel selection still allowed). No hide toggle (decision 21).
- **T7.5 (PR 7.B)** — guias persistence: `localStorage estudio_guias_{user.id}`, absent = ON (owns persistence; T2.7 shipped the toggle only — decision 21/verifier m16).
- **T7.6 (PR 7.B)** — template groundwork = pure `instantiateDoc(sourceDoc)` (deep clone, re-mint ids, schema-valid output). No table, no UI (decision 21).
- **Must NOT sneak in** (§15): multi-select group transforms, template library/sticker pack, gradient/outlined text, image crop/focal point, font upload, stories, page-level replace, pre-sized variants, Twemoji R2 mirror, pro-tier model.

---

## 9. Standing risks during execution

Design §14 risks R1–R7 stay live; the plan additions: the T2.5 measurement spike runs before heavy editor work (its fallback is a slice-1 schema change); the T2.13 parity fixture is the merge-blocking drift alarm; T1.8's R1 numbers decide whether the Cloudflare fallback needs activating before slice 2 ships; plan-tier seeds (§14a) must be decided before flipping `feature_estudio` on any plan, but everything merges dark without them.
