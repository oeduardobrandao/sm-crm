# Estúdio v2 — keep/discard inventory (v1 branch vs main)

**Date:** 2026-07-04
**Companion to:** `2026-07-04-openpencil-estudio-design.md`
**Context:** `feat/estudio-post-editor` (~30 commits, 344 files, +38k LOC vs main) will never merge to main on its own. The pivot branch `feat/estudio-openpencil` contains it; everything marked **discard** is physically deleted on the pivot branch, so the eventual PR to main ships only the kept surface. Prod edge functions/migrations were deployed straight from the v1 branch, so "discard" sometimes also means **decommission live infra** (section D).

## A. Kept as-is

| Area | Files | Why it survives |
|---|---|---|
| DB schema & RPCs | `supabase/migrations/20260702000001..06` (post_designs, design_asset_refs, ai_image_generations, plans columns, claim/reap RPCs, sweep cron schedule) | Applied to prod; the concurrency model (rev, doc_hash, is_stale, render_status/manifest), asset refcounts, and finalize RPC are doc-format-agnostic. v2 adds ONE new migration (blob pointer), never edits these. |
| AI image generation | `generate-image/` fn, `_shared/image-gen/` (core, provider, gemini, openrouter, resolve), `mcp/imageGen.ts`, ai-image quota/ledger, tests | Completely independent of the doc format. Live-verified E2E on prod. |
| Publish gate & lifecycle | `_shared/instagram-publish-utils.ts`, `instagram-publish/`, `instagram-publish-cron/`, `hub-approve/` changes, `_shared/reel-cover-staleness.ts`, gate tests | Gate logic reads `is_stale`/`render_status`/link rows — never parses the doc. Reel video-swap staleness likewise. |
| Brand kit backend | `_shared/brand-logo.ts` (SSRF-hardened logo import), `hub-brand` integration, brand-logo tests | Materializes the client logo into `files` — format-agnostic; v2 editor loads brand via the same endpoint. |
| Media plumbing | `file-manage/`, `file-upload-finalize/`, `post-media-manage/` changes (asset refs, design ownership), `sign-r2-urls` GET byte-proxy | Refcounting and ownership semantics unchanged; the byte-proxy is still needed for canvas image bytes (R2 bucket CORS covers prod origins only). |
| Entitlements & plans | `_shared/entitlements.ts` (feature_estudio, feature_ai_images, rate_ai_images_per_month), admin plan-form, `useWorkspaceLimits`, `entitlement-errors.ts` | The v2 rollout uses the exact same flags/quotas. |
| MCP scopes & keys | `_shared/mcp-token.ts`, scope registry changes (`designs:write`, `images:generate`), CRM `mcp-scopes.ts`, mcp-keys UI/tests | Scope names unchanged in v2 → no redeploy wave. |
| CRM lifecycle surfaces | `WorkflowDrawer` design summary + "Abrir no Estúdio", `PostMediaGallery` "Gerenciado pelo Estúdio" ownership banner, `store/hub.ts` / `posts.ts` changes | Behavior identical; only the editor link target changes. |
| Font assets & tooling | `public/fonts/estudio/` (126 TTF/woff2, 4.4 MB), `scripts/fonts/build.mjs`, `_shared/fonts/` (manifest, keys, match, lookup) + tests | v2 needs the same curated font set in the OpenPencil editor AND byte-identical in the doc service renderer; brand-font matching feeds `get_design_capabilities`. Assets will be *relocated* (served to the editor app + bundled/fetched by the doc service) but not rewritten. |
| Dev/docs | `.claude/launch.json`, `docs/estudio-design.md` (historical/authoritative-where-kept), `docs/estudio-plan.md` | Reference. |

## B. Kept with modification

| Piece | What changes |
|---|---|
| `post-design-manage/` (637 LOC) | Stays the save/load/gate/tenancy endpoint. GET/PUT move from jsonb doc to `.pen` blob (R2 pointer + hash computed in-endpoint); §2.4 zod pipeline replaced by thin frame-level validation (parse, frame count/aspect, ≤10 carousel, blob size, known fonts); tipo-sync logic kept; `POST /brand-logo` and DELETE cascade kept as-is. |
| `_shared/design-render-status.ts` | Keeps building the `render: {status, pages}` projection from link rows (semantics untouched); drops its `design-doc.ts` type import, keys pages by frame ids. |
| `_shared/design-render-trigger.ts` | Same fire-and-forget pattern, retargeted from the `design-render` edge fn to the Vercel doc service (new internal secret header). |
| `design-render-sweep-cron/` | Same stuck-row sweep, re-fires against the doc service instead of `design-render`. |
| MCP design tools (`mcp/design.ts` 421 LOC, `mcp/capabilities.ts`, `tools.ts` registrations) | Same 6 tool names/scopes/gates/auto-moves; payloads become the scene-graph JSON projection; document parsing/mutation delegated to the doc service. `docs/estudio-mcp-guide.md` rewritten to match. |
| CRM entry (`App.tsx`, `main.tsx`, `nav-data.ts`, `EstudioPage` successor) | Route + feature gate survive; the page becomes a thin iframe shell (postMessage bridge) instead of the 9k LOC editor. |
| `store/postDesigns.ts` | Still powers the drawer summary; response shape loses the inline doc, gains blob/render metadata. |
| i18n (`packages/i18n/locales/*/estudio.json`, posts/common additions) | Keys for drawer/gallery/quota/errors survive; editor-internal keys (toolbars, panels) die with the old UI; the fork brings its own strings (needs pt-BR pass). |
| `supabase/config.toml` | Keeps fn registrations; `design-render` entry removed at decommission. |
| CLAUDE.md | Estúdio sections updated to v2 architecture. |

## C. Discarded (delete on pivot branch)

| Bucket | Files | LOC |
|---|---|---|
| v1 editor UI | `apps/crm/src/pages/estudio/` — components (Canvas/Toolbar/Dock/Layers/SlideStrip/PostPicker/shared), hooks (incl. `useSatoriRenderer`, `useTextMeasurement`, `useAutosave`¹), lib (designDocOps, layerGeometry, snapMath, runsMapping, imageResolution, estudioStash), `EstudioPage.tsx`, `types.ts`, `services/imageGen.ts`² | 9,087 |
| v1 editor tests | `apps/crm/src/pages/estudio/__tests__/` | 8,275 |
| JSON doc schema + satori stack | `_shared/design-doc.ts` (879), `design-doc-fixtures.ts`, `design-render-core.ts` (satori+resvg+mozjpeg), `design-render-tree.ts`, `parity-fixture.ts`, `design-render/` fn | 2,633 |
| Their tests | design-doc-schema, design-render-core/-tree/-render, estudio-render-parity (deno + vitest), `test/parity/estudio-parity-golden.svg`, font-match test stays (fonts kept) | ~1,381 |
| Frontend deps | `satori`, resvg/mozjpeg wasm entries in CRM `package.json` / lockfile; vitest satori setup in `test/vitest.setup.ts` / `vitest.config.ts` | — |

¹ Autosave/conflict/stash *concepts* (expected_rev guard, 409 → local stash + banner) are reimplemented in the fork's persistence adapter; the React implementations die.
² `GerarImagemPanel` + `services/imageGen.ts` are reborn inside the fork as the one custom panel, calling the same `generate-image` endpoint.

**Net effect on the eventual PR to main:** roughly −21k LOC of the +38k the v1 branch added, before the new (much smaller) v2 CRM surface is added.

## D. Live prod infra to decommission at cutover (not just code)

1. **`design-render` edge fn** — deployed on prod; undeploy after the doc service takes over rendering (publish gate must never point at a dead renderer — retarget first, then undeploy).
2. **`design-render-sweep-cron`** — retarget (B) before the fn swap; the pg_cron schedule (migration 05) stays, the fn it calls changes behavior.
3. **`post_designs` rows** — wipe (DK TESTE test data only, per approved decision); `design_asset_refs` refcounts release the orphaned files to the existing R2 cleanup path.
4. **Fonts served from CRM `public/`** — relocate to the editor app / doc service; remove from CRM bundle afterwards.
5. **`mcp` fn** — redeploy with the new design.ts payloads at cutover (scopes unchanged → only the one fn).

## E. Order of operations constraint

Prod currently runs v1 backend deployed from the branch. Nothing in C may be deleted from *deployed* functions until the v2 path is live-verified (spike + slices). Deleting on the pivot branch is safe immediately for CRM UI code (dark feature) but edge-function deletions must trail their D-item decommission step.
