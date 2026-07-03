# Estúdio — Implementation Plan (v1)

Status: **draft for approval, rev 2** · 2026-07-02 · branch `feat/estudio-post-editor`
Companion to [estudio-design.md](estudio-design.md) (amended twice on 2026-07-02: first from plan verification, then from the external review — media semantics, single-write-path RPCs, quota reservations, atomic finalize, waitUntil contract, satori entrypoints, SSRF hardening).
Provenance: 7-drafter + 1-verifier workflow (`wf_cdaebfe4-abc`), then an external review whose 4 blockers and 5 majors were **verified against the repo and accepted** (one sub-claim refuted: `insertAuditLog` swallows failures by design, so audit can never fail a paid call). Section 1 records every ruling.

---

## 0. How to execute

- Slices run **in order 1 → 7**; inside a slice, PRs run in the listed order. Every PR branches off `main` (`feat/estudio-s<slice>-<short-name>`), stays green behind `feature_estudio=false`, and passes the full gate before push:
  `npm run format && npm run lint && npm run build && npm run test && npm run test:functions`
  (`build` = tsc typecheck; `test:functions` carries the required Deno permission flags — never bare `deno test`).
- **Two separate lockfiles — do not conflate them (corrected from PR 1.2, which conflated them):**
  - Root `deno.lock`: **always revert it** (`git checkout deno.lock`), never commit a diff. Some ad-hoc local `deno` invocations (observed inconsistently across shells/versions — not fully root-caused) rewrite it as a full snapshot of the *entire* root `package.json` dependency graph (thousands of lines), not a surgical diff. Safe to discard because `.github/workflows/ci.yml`'s `npm run test:functions` resolves dependencies fresh every run regardless of what's committed. After any local `deno` invocation, check `git status --porcelain deno.lock`; if dirty, `git checkout deno.lock && npm ci` — and if a build afterward shows cross-version type errors (two versions of the same package clashing), a stray `node_modules/.deno/<pkg>@<version>` directory survived; re-run `npm ci` (a from-scratch wipe+reinstall) rather than hand-deleting the specific stray directory.
  - `supabase/functions/deno.lock`: a **separate, correctly-scoped lockfile** for the import map in `supabase/functions/deno.json`. Running the canonical `npm run test:functions` (or any `deno` command targeting `supabase/functions/`) updates ONLY this file, cleanly and stably — verified in PR 1.4 by diffing it before/after adding satori/resvg-wasm/@jsquash/jpeg/@std/encoding: the diff contained exactly those new packages and their real transitive deps, nothing else, and a second run produced zero further diff. **Commit this file's changes** whenever a PR intentionally adds a new Deno-side dependency (this is what design §11's original "commit the updated lockfile for intentional deps" guidance was correct about — PR 1.2 wrongly applied that correction to the root lockfile too).
- Migrations apply via SQL editor per design §4.4 (both envs; record versions). Prod mirrors staging with the identical ordered sequence (design §12). **The cron-schedule migration (000004) applies only AFTER its function deploys** — pg_cron HTTP failures are silent.
- New no-JWT functions get `supabase/config.toml` entries + `__tests__/config-audit_test.ts` updates.
- Edge deploys: `--use-api`; `--no-verify-jwt` only for `design-render` + sweep cron.
- `_shared/` modules sit outside the prettier/eslint globs — format manually with the repo config.

### PR map (22 PRs)

| Slice | PR | Scope |
|---|---|---|
| 1 | 1.1 | Migrations 000001–000003 (incl. save/delete RPCs, design_asset_refs, reservation trigger) + entitlements + 6 mirrors |
| 1 | 1.2 | `_shared/design-doc.ts` schema + fixtures + dual-runtime tests + zod@4 mapping + alias triple |
| 1 | 1.3 | Fonts pipeline: build script, manifest/keys/types/match, public assets, R2 upload, `@mesaas/fonts` alias |
| 1 | 1.4 | R2 helpers + `design-render-tree` (pure, aliased) + `design-render-core` (wasm) + `design-render` fn (single page) + config.toml + **deploy smoke test** |
| 1 | 1.5 | Render chaining (waitUntil) + sweep cron + migration 000004 |
| 1 | 1.6 | `post-design-manage` fn + staging rollout + seeded-doc DoD + R1 load test |
| 2 | 2.A | Deps, route/nav/i18n, doc-state core, picker + entry flow (T2.5 measurement spike runs FIRST) |
| 2 | 2.B1 | Browser satori (standalone) + font loading + measurement cache + zoom/pan |
| 2 | 2.B2 | Selection/drag/resize + snapping + IG safe-zone guides |
| 2 | 2.C | ContextualToolbar + TipTap text overlay + image insert paths + SlideStrip |
| 2 | 2.D | Autosave protocol + conflict banner + stash + **parity fixture** + integration tests |
| 3 | 3.A | Logo materialization (`POST post-design-manage/brand-logo`, full SSRF contract) |
| 3 | 3.B | FontPicker + ColorPicker + BrandPanel + HubTab BrandEditor upgrade |
| 4 | 4.A | Edge: design-readiness gate + publish-cron re-check + stale re-trigger + `origin` in post-media-manage |
| 4 | 4.B | CRM: `store/postDesigns.ts`, "Abrir no Estúdio", PostMediaGallery ownership mode |
| 5 | 5.A | Scopes + `mcp/design.ts` glue + `get/create/update_design` (via save RPC) + tests |
| 5 | 5.B | `_shared/image-gen/*` + `generate_image` (idempotency, reservations) + CLAUDE.md env docs |
| 5 | 5.C | `preview_design` (imageResult) + `get_design_capabilities` + agent guidance |
| 6 | 6.A | `generate-image` edge entrypoint + deno tests + billing alert |
| 6 | 6.B | CRM: service/mutation + Gerar imagem panel + quota meter + insert flow |
| 7 | 7.A | Rotation handles + align ops + keyboard shortcuts |
| 7 | 7.B | LayerListPanel (create) + guias persistence + template `instantiateDoc` op |

---

## 1. Resolved decisions

### 1a. From the internal verifier (round 1)

1. **Tree builder mandatory and shared**: `_shared/design-render-tree.ts` runtime-neutral, aliased `@mesaas/design-render-tree`; core wraps it with wasm; editor consumes the same module.
2. **Parity fixture owned by PR 2.D**: golden doc through browser-satori (vitest) and edge-satori (deno) → byte-identical SVG strings; merge-blocking drift alarm.
3. **ContextualToolbar created in PR 2.C** (was a phantom): per-layer-type controls.
4. **LayerListPanel created in slice 7** (was a phantom).
5. **Format switching syncs `tipo` server-side** — now inside the `save_post_design` RPC (see 1b-2), so MCP writes get it for free.
6. **Single ownership**: `match.ts` + tests → PR 1.3; `putObject`/`getObjectBytes` → PR 1.4; `useFontManifest` → PR 2.B1.
7. `@mesaas/fonts` alias lands in PR 1.3.
8. Cron-schedule migration after fn deploy (now design §12 step 5).
9. Slice-2 PR-B split in two.
10. No nanoid dep — inline `crypto.getRandomValues` generator (spelled-out `a–z0–9` alphabet) in `design-doc.ts`.
11. `layout` (measured bboxes) only on MCP responses, never the editor PUT.
12. ~~Column grants include post_id/conta_id~~ — superseded by 1b-2 (no direct writes at all).
13. `generate_image` never creates `post_file_links` — `post_id` is ledger metadata only.
14. `placement?: 'background'|'element'` keys the 2K/1K quality default.
15. All four ARs incl. 16:9.
16. `update_design` also auto-moves `correcao_cliente`.
17. `auditArgs(args, result)` extension for spend audits.
18. Brand context = hub_brand colors + especialidade folded into the prompt server-side; `use_brand_logo` adds the logo as a reference image.
19. Quota meter initial read = RLS-scoped count (predicate matches 1b-3 reservations).
20. Cron re-check: pending/rendering → clear lock + skip; failed → markFailed. Schedule-time gate fire-and-forgets a render re-trigger (via waitUntil) when blocking on stale/failed.
21. v1 acceptances: user-id-keyed localStorage persistence; no `hidden` field; distribute UI deferred; template groundwork = `instantiateDoc` only; native ColorPicker; Hub Marca keeps `logo_url` display; hub-approve silent-skip accepted (backlog).
22. Client-side validation module dropped — server `warnings[]`/`issues[]` + reducer-level structural limits.
23. PR 2.A must not reach prod before slice 1's entitlements deploy (nav-flag `undefined` ≠ hidden).
24. Google-side billing alert (~2× plan caps) in slice 6 checklist.
25. Open product decisions (user-owned, non-blocking for dark merges): plan-tier seeds/quotas, beta gating, prompt retention.

### 1b. From the external review (round 2 — all repo-verified)

1. **Media semantics** (blocker 1, confirmed: `fetchPostMedia`/`validateForScheduling` consume every link; `media.length > 1` triggers the carousel path; the reel cover is sourced from the video file's `thumbnail_r2_key`): design §5.2 now defines the authoritative rules — feed/carrossel designs **replace ALL image links** at finalize (manual files stay in Arquivos, old design files rows deleted); design creation on feed/carrossel posts with video media is a validation error (`post_has_video_media`); **reel covers create NO link** — finalize writes the rendered JPEG to the linked video's `thumbnail_r2_key` (PATCH-thumbnail precedent), requiring exactly one video link with `reference_count = 1`; `delete_post_design` semantics specified (feed/carrossel → design links + files removed, post left media-less; reels → thumbnail persists, replaceable). `post-media-manage` adds `origin` to its response (confirmed omitted today).
2. **Single write path** (blocker 2): authenticated is **SELECT-only** on `post_designs`; all writes via SECURITY DEFINER `save_post_design`/`delete_post_design` RPCs (service_role EXECUTE), which atomically enforce post↔conta ownership (closes the guessed-foreign-post_id hole), status guard, rev guard, tipo sync, and `design_asset_refs` diffing. `post-design-manage` and MCP both call the RPCs after zod validation. New `design_asset_refs` table pins doc-referenced files against garbage collection.
3. **Quota reservations** (blocker 3, confirmed: the advisory lock can't count invisible pendings): trigger + pre-check predicate = `succeeded OR (pending AND created_at > now() - 10 min)` — pendings reserve, failures release, stuck pendings self-expire. `idempotency_key` column + partial unique index; CRM sends a per-submission UUID, MCP exposes an optional arg. Core tenant-verifies `client_id`, `post_id`, and `reference_file_ids`.
4. **Atomic, leak-safe finalize** (blocker 4, confirmed: `file_deletions` queues only on files-row DELETE): chunks upload R2 bytes + append to `post_designs.render_manifest` — **no per-chunk files rows**; `finalize_design_render(design_id, claimed_hash, manifest)` is one transaction (hash re-check → `file_insert_with_quota` per page → media swap per 1b-1 → previous render's files rows DELETEd → rendered state). Stale/abort paths queue the manifest's R2 keys into `file_deletions` directly.
5. **Satori entrypoints** (major 5, confirmed via the 0.26.0 manifest: exports `.`, `./standalone`, `./jsx`, `./yoga.wasm`; dep `yoga-layout@^3.2.1`): browser uses `satori/standalone` + the packaged `satori/yoga.wasm`. `satori/wasm` and `yoga-wasm-web` removed from all tasks. PR 1.4 gains a real `--use-api` deploy smoke test (no static files on API deploys; 20 MB bundle cap — our wasm loads from CDN/R2 at runtime, proven not assumed).
6. **`EdgeRuntime.waitUntil` contract** (major 6, confirmed: zero usages in the repo today): every fire-and-forget — chunk self-invocation, render triggers from saves/MCP, the schedule-time re-trigger — is `EdgeRuntime.waitUntil(promise.catch(log))`. Injectable in tests.
7. **Autosave concurrency protocol** (major 7): single in-flight save, local generation counter, queued-dirty re-arm, stale responses adopt only `rev` (never replace newer local docs), React Router navigation blocker while dirty, stash before unload.
8. **MCP result handling** (major 8, partially refuted): `insertAuditLog` verifiably swallows failures ("must never break the primary operation") — audit cannot fail a paid call. Accepted parts: `imageResult` helper for `preview_design` content blocks; `get_design_capabilities` is a pure read (logo materialization only via explicit writes: the `/brand-logo` route or `generate_image use_brand_logo`).
9. **SSRF contract completed** (major 9): https-only; IP-literal rejection in any notation (IPv4 decimal/octal/hex + IPv6 normalized first); DNS-resolve + private/link-local/loopback rejection immediately before fetch; `redirect: 'manual'` with all 3xx rejected; 10 s timeout; ≤5 MB streamed cap; content-type + magic-byte sniff; residual rebinding TOCTOU documented as accepted v1 risk. Tests cover redirects and literal notations.
10. **Hygiene**: PR count corrected to 22; latest migration is `20260701000001` (the `20260702*` series remains free); gate includes `npm run build` and uses `npm run test:functions`; deno.lock nuance; config.toml + config-audit tasks added; explicit ordered prod rollout added to T1.8 (mirrors design §12).

---

## 2. Slice 1 — Foundations

**DoD:** a seeded 2-page doc saved through `post-design-manage` renders to JPEGs visible in the client Hub on staging; R1 load-test numbers recorded.

### T1.1 — Migrations 000001–000003 (PR 1.1)
- Files: `supabase/migrations/20260702000001_post_designs.sql`, `..000002_ai_image_generations.sql`, `..000003_plans_estudio_columns.sql` (latest on disk `20260701000001`; the 20260702 series is free).
- 000001: `post_designs` DDL per design §4.1 incl. `render_manifest jsonb`; BEFORE trigger (doc_hash, updated_at, **rev bump**, render_status reset); RLS **SELECT-only** for authenticated + service bypass; `REVOKE INSERT/UPDATE/DELETE` from authenticated; SECURITY DEFINER RPCs `save_post_design` (ownership + status + rev guard + tipo sync + asset-refs diff, one transaction), `delete_post_design` (per-format semantics §5.2), `claim_design_render`, `finalize_design_render` (hash re-check → `file_insert_with_quota` per page → media swap incl. reel-cover thumbnail application → old design files rows DELETEd → rendered state), `fail_design_render` — all service_role-only EXECUTE; **`design_asset_refs`** table + the reference-count trigger attached; `post_file_links.origin` ALTER; `hub_brand.logo_file_id` ALTER.
- 000002: ledger DDL per §4.2 incl. `idempotency_key` + partial unique index; RLS member-read/service-write; BEFORE-INSERT `enforce_plan_count_limit` with the **reservation predicate** `status = 'succeeded' OR (status = 'pending' AND created_at > now() - interval '10 minutes')`.
- 000003: plans ALTERs + zero-backfill + commented seed placeholders incl. `lifetime`.
- All idempotent (apply cleanly twice); RPC behavior exercised by the deno suites in T1.5/T1.7.
- Done when: staging double-apply clean; `npm run test:functions` green.

### T1.2 — Shared schema module + dual-runtime tests (PR 1.2)
As drafted in rev 1 (zod@4 mapping, `.strict()` schema, Stage 0/1/2, fixtures, alias triple, dual suites) plus: Stage-1 adds `post_has_video_media` (design §2.4 rule 6); normalization exposes the doc's `file_id` set for the save RPC's asset-refs diff. Full gate incl. `npm run build` proves the alias.

### T1.3 — Entitlements + 6 mirrors (PR 1.1)
As rev 1: entitlements.ts arrays; admin api.ts + plan-form fixture + platform-admin drop-assertions; `useWorkspaceLimits` (+ the already-missing `feature_mcp`/`max_mcp_keys`); NAV_FEATURE entry; entitlement-errors PT labels.

### T1.4 — Fonts pipeline (PR 1.3)
As rev 1: families.json (26/50), build.mjs with drift gate, pinned static latin+latin-ext TTFs, preview strips, `fonts.css`, R2 `assets/fonts/v1/` idempotent upload, generated manifest/keys/types + ATTRIBUTION, hand-written pure `match.ts` **owned here with tests**, `@mesaas/fonts` alias triple, latin-ext per-glyph fallback verification (drop latin-ext if unreliable).

### T1.5 — R2 helpers + tree + core + `design-render` single page (PR 1.4)
- `_shared/r2.ts`: `putObject` + `getObjectBytes` (sole owner).
- `_shared/design-render-tree.ts` (**mandatory pure module**, aliased): §5.2 render contract — pre-wrap/break-word, runs→spans, per-line run highlights, block pill split on `\n`, bg `<img objectFit>`, rgba overlays, overflow hidden, `{{page}}/{{pages}}`, Twemoji-17.0.3 callback config.
- `_shared/design-render-core.ts`: pinned `npm:satori@0.26.0` / `npm:@resvg/resvg-wasm@2.6.2` / `npm:@jsquash/jpeg@1.6.0/encode.js`; module-scope wasm init; font/emoji LRU byte caches; `renderPage(doc, i, deps, {width?})`; `measureLayer` via resvg getBBox.
- `design-render` fn: x-cron-secret; claim RPC; page-0 render; R2 write `contas/{conta_id}/designs/{id}/{rev}/{page_id}.jpg`; **append to `render_manifest`, no per-chunk files rows**; single-page docs call `finalize_design_render` with the one-page manifest; stale/abort paths queue manifest keys into `file_deletions`.
- config.toml `[functions.design-render]` + config-audit test update.
- **Deploy smoke test**: staging `--use-api` deploy + one real render inside this PR (bundle cap + runtime wasm loading proven on real infra).
- Tests: golden-doc SVG snapshot; secret rejection; stale-rev 204; claim 409; finalize atomicity (stale hash → zero writes); manifest accumulation; abort-queues-deletions; reel-cover paths (no video → sanitized failure; shared video `reference_count > 1` → sanitized failure; happy path swaps `thumbnail_r2_key` + queues old thumb); feed/carrossel replace-all deletes manual LINKS but never manual FILES rows.

### T1.6 — Chaining + sweep cron (PR 1.5)
Chunked calls re-read row (abort 204 on rev/status change); self-invocation via **`EdgeRuntime.waitUntil`** (injectable); finalize only on last page; sweep cron re-fires stuck rows >2 min, cron-failure email; config.toml + config-audit entry; migration `20260702000005` (vault-view schedule, every 2 min) applied **after** deploys.
Review-driven change from the literal plan: the sweep cron does **not** decide what to queue into `file_deletions` itself. An earlier draft had it reap a stuck row's `render_manifest` from its own `findStuckRows()` snapshot — adversarial review caught a real TOCTOU race (a slow-but-alive render can legitimately `finalize_design_render` between the snapshot read and the sweep's re-fire call, without `rev` changing, since finalize never touches `doc`; the sweep would then reclaim the now-`'rendered'` row and misread its own stale snapshot as "safe to delete," queuing a just-published post's live media). Fixed by moving the reap into `claim_design_render` itself (migration `20260702000004`): it takes the row lock (`SELECT ... FOR UPDATE`) before deciding reclaimability, and if it reclaims a row that was *actually* `'rendering'` under that lock, it queues that row's *current* manifest atomically in the same transaction — the only place this decision can be race-free. The sweep cron is now a thin loop: re-fire, count refired/skipped(no-op)/failed.

### T1.7 — `post-design-manage` (PR 1.6)
JWT ON + cors + profile→conta; **all writes via `save_post_design`/`delete_post_design` RPCs** (no direct table writes — grants make it impossible); GET get-or-create routes creation through the save RPC (starter doc from tipo + existing cover); PUT = feature gate → shared validation (incl. `post_has_video_media`) → save RPC (ownership/status/rev/tipo/asset-refs inside) → render trigger via waitUntil → `{design, rev, warnings}`; DELETE via RPC; audit without doc contents.
Tests: tenancy denial; foreign-post_id attach rejected; feature gate; status guard; aggregated issues; `rev_conflict {current_rev}`; tipo-sync recorded; trigger-failure non-fatal; starter doc; audit redaction.

### T1.8 — Staging + prod rollout, DoD, R1 (PR 1.6, ops)
- Staging: migrations 000001–000003 (SQL editor + record) → fonts `--upload` → config.toml deploys (`design-render`, sweep, `post-design-manage`, `workspace-limits`, `platform-admin`) → **then** 000004 → seed the §2.6 fixture through the API → assert `rendered`/`!is_stale`/2 `origin='design'` links → verify in Hub.
- **Prod (explicit, same order)**: after staging soak — migrations 000001–000003 → fonts upload to prod R2 → deploys → 000004 → verify `lifetime` plan row + config-audit green. Feature stays dark.
- R1: `scripts/estudio/load-test-render.mjs` p50/p95 across 1080×1350, 1080×1920, and 512-preview (photo-heavy + text-only); results recorded on the PR and in design §14 R1.

---

## 3. Slice 2 — Editor MVP

Tasks as drafted in rev 1 with these deltas:

- **T2.1** (PR 2.A): deps are `satori: "0.26.0"` only — yoga ships inside satori (`yoga-layout` dep + `satori/yoga.wasm` export); **no yoga-wasm-web, no nanoid**. Route/nav/i18n unchanged; prod-ordering constraint per decision 23.
- **T2.2** (PR 2.A): designDocOps + reducer as drafted (ids from the shared generator).
- **T2.3** (PR 2.A): picker + Post Express-pattern entry flow + `usePostDesignQuery` (GET get-or-create) as drafted.
- **T2.5** (runs FIRST): measurement cache spike as drafted; timeboxed; fallback is a slice-1 schema change — stop and report, don't improvise.
- **T2.4** (PR 2.B1): `useSatoriRenderer` imports **`satori/standalone`**, yoga initialized from **`satori/yoga.wasm`** via Vite asset URL (decision 1b-5); tree via `@mesaas/design-render-tree`; **owns `useFontManifest`** (single TTF download shared with `@font-face`); identical Twemoji callback; SatoriPreview debounced ~150 ms commit renders; `useCanvasTransform`.
- **T2.6/T2.7** (PR 2.B2): selection/drag/resize (transient ghost, one commit per gesture) + snapping + §6.6 safe-zone guides (toggle only; persistence is slice 7).
- **T2.12** (PR 2.C): **ContextualToolbar** (created here): text variant (stopgap font select, size, weight, hex color input, align, shadow, pill), image variant (fit/radius/border/replace), shape variant (fill/stroke/radius); slice 3 swaps in FontPicker/ColorPicker.
- **T2.8** (PR 2.C): TipTap overlay ↔ runs mapping as drafted.
- **T2.9** (PR 2.C): insert paths (upload **without postId**, paste, dnd, Arquivos picker) + LeftToolDock; reels-format editor shows the "adicione o vídeo do reel" notice when no video link exists (render fails without it — design §5.2).
- **T2.10** (PR 2.C): SlideStrip as drafted.
- **T2.11** (PR 2.D): autosave implements the **full concurrency protocol** (decision 1b-7): single-flight mutex, generation counter, queued-dirty re-arm, stale-response rev-only adoption, `useBlocker` while dirty, stash-before-unload; conflict banner + localStorage stash; issues/warnings via sonner. Tests: interleaved-save races (an older response never clobbers newer edits), blocker engagement, stash contents.
- **T2.13** (PR 2.D): **parity fixture** — byte-identical SVG from both engines; merge-blocking.

Coverage-ratchet payers unchanged: designDocOps, layerGeometry, snapMath, runsMapping, textMeasure, canvasTransform, imageResolution, reducer.

---

## 4. Slice 3 — Brand kit + fonts in the editor

As drafted in rev 1 (T3.1 consume-matcher, T3.4 FontPicker, T3.5 ColorPicker, T3.6 BrandPanel, T3.7 HubTab upgrade; T3.3 folded into T2.4) with one delta:

- **T3.2** (PR 3.A) — logo materialization implements the **completed SSRF contract** (decision 1b-9): https-only; IP-literal rejection across notations (normalize IPv4 decimal/octal/hex + IPv6 before judging); DNS-resolve + private/link-local/loopback rejection immediately pre-fetch; `redirect: 'manual'`, any 3xx rejected; 10 s timeout; ≤5 MB streamed cap; content-type + magic-byte sniff; residual rebinding TOCTOU documented in the module header. Tests add: 301/302/307 rejection; decimal/octal/hex IPv4 literals; IPv6 + `[::1]`; DNS-to-private rejection.

---

## 5. Slice 4 — Lifecycle integration

As drafted in rev 1 with these deltas:

- **T4.1** (PR 4.A): `checkDesignReadiness` in `validateForScheduling` as drafted (+ the mock-seeding trap for all three test files); stale/failed branch fires the render re-trigger via **`EdgeRuntime.waitUntil`**; **adds `origin` to `post-media-manage`'s `toLegacy` response** (confirmed omitted today) so the CRM can distinguish tiles.
- **T4.2** (PR 4.A): publish-cron container-phase re-check as drafted (pending/rendering → clear lock + skip; failed → markFailed).
- **T4.3** (PR 4.B): `store/postDesigns.ts` (`getPostDesignSummary` via direct RLS select — never the GET route) + `PostMedia.origin` type.
- **T4.4** (PR 4.B): OpenInEstudioButton as drafted.
- **T4.5** (PR 4.B): ownership mode updated for the thumbnail-based reel cover (decision 1b-1): **no design cover tile exists** — the video tile's thumbnail *is* the rendered cover; banner "capa gerenciada pelo Estúdio — vídeo manual"; the thumbnail-picker/"editar capa" affordances are hidden while a design exists; video upload allowed, image files rejected. Feed/carrossel: gallery fully disabled with banner.

---

## 6. Slice 5 — MCP tools

As drafted in rev 1 with these deltas:

- **T5.1** (PR 5.A): scopes as drafted.
- **T5.2** (PR 5.A): validation glue as drafted (+ `post_has_video_media` flows through from the shared module).
- **T5.3** (PR 5.A): create/update **write through `save_post_design`** — ownership, status, rev guard, tipo sync, asset-refs inherited; no bespoke write path; render trigger via waitUntil; measure-pass `layout` in responses; audit metadata as drafted.
- **T5.4** (PR 5.B): `generate_image` args add `placement?` + `idempotency_key?`; pre-check uses the **reservation predicate**; tenant-verifies `client_id`/`post_id`/`reference_file_ids`; idempotent replay returns the existing generation (no second provider call); `auditArgs(args, result)` extension; CLAUDE.md `GEMINI_API_KEY`.
- **T5.5** (PR 5.C): `preview_design` via the new **`imageResult`** helper (raw image content block); `get_design_capabilities` is a **pure read** — `logo_file_id` when materialized, else null.
- **T5.6** (PR 5.C): agent guidance (tool descriptions + `docs/estudio-mcp-guide.md`) as drafted.

---

## 7. Slice 6 — In-editor AI generation

As drafted in rev 1 with these deltas:

- **T6.1/T6.2** (PR 6.A): entrypoint forwards a per-submission UUID `idempotency_key`; tests add idempotent replay (same key → same file_id, one provider call) and reservation behavior (in-flight pendings block the (N+1)th concurrent request at the cap). Staging checklist: **Google billing alert** at ~2× the sum of plan caps.
- **T6.3** (PR 6.B): service + entitlement-error mapping as drafted.
- **T6.4** (PR 6.B): panel as drafted; quota meter counts with the **reservation predicate** so the UI matches server truth.

---

## 8. Slice 7 — Polish

Unchanged from rev 1: T7.1 rotation handles, T7.2 align ops (distribute UI deferred), T7.3 keyboard shortcuts, **T7.4 creates LayerListPanel**, T7.5 guias persistence (`estudio_guias_{user.id}`), T7.6 `instantiateDoc`. The §15 must-not-sneak-in list stands.

---

## 9. Standing risks during execution

Design §14 risks stay live, plus: the T2.5 measurement spike runs before heavy editor work (its fallback is a slice-1 schema change); the T2.13 parity fixture is the merge-blocking drift alarm; T1.5's deploy smoke test and T1.8's R1 numbers decide whether the Cloudflare fallback needs activating before slice 2 ships; the reel-cover shared-video (`reference_count > 1`) failure is rare but user-visible — its sanitized message must be actionable; plan-tier seeds (§14a) must be decided before flipping `feature_estudio` on any plan, but everything merges dark without them.
