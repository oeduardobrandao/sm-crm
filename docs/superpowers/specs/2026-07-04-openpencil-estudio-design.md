# Estúdio v2 — OpenPencil adoption

**Date:** 2026-07-04
**Status:** Approved (design). Phase 0 spike PASSED 2026-07-04 (GO) — see `2026-07-04-openpencil-spike-findings.md`.
**Amendment (from spike):** the stored blob format is **`.fig`** (their native read/write document format), not `.pen` (read-only interchange). Read every "`.pen`" below as "`.fig`". WYSIWYG parity is guaranteed by pinning `@open-pencil/core` — verified byte-identical renders across macOS and Vercel Linux.
**Branch:** `feat/estudio-openpencil` (based on `feat/estudio-post-editor`)
**Supersedes:** the custom editor UI + satori render pipeline described in `docs/estudio-design.md`. The workflow/lifecycle/quota contracts in that document remain authoritative where this spec says "kept".

## 1. Context and decision

The custom Estúdio editor (~9k LOC of React canvas UI) shipped complete but disappointed on two axes: **canvas feel** (drag/resize/text editing vs Figma-class tools) and **velocity** (we cannot sustain building editor UX ourselves). Feature depth and AI output quality were *not* the problems.

Decision: adopt **OpenPencil** (github.com/open-pencil/open-pencil, MIT, Skia/CanvasKit rendering, Vue 3) as the editor, with its `.pen` document as the **source of truth**, replacing both our editor UI and the satori server-render pipeline. A hybrid (OpenPencil UI over our JSON schema) was rejected: Skia and satori lay out text differently, so keeping satori for publish output while editing in Skia breaks WYSIWYG — one renderer must own both.

Verified facts this design rests on:

- OpenPencil is MIT-licensed, actively developed (v0.13.2, pushed daily), ~6 months old.
- `@open-pencil/core` loads `.pen`/`.fig` documents headlessly in plain Node via `canvaskit-wasm` (no browser) and exports pages/nodes to PNG/JPG/WEBP (`IORegistry.readDocument({name, data})` → `computeAllLayouts(graph)` → `io.exportContent(...)`, see their `packages/cli/src/headless.ts` and `commands/export.ts`).
- `@open-pencil/vue` provides composables + headless primitives, **not** a drop-in editor component; the polished editor UI is the app at the repo root.
- Everything Estúdio ships dark (`feature_estudio` / `feature_ai_images` false on all plans; only the DK TESTE workspace has overrides), so every internal contract — including MCP tool argument shapes — may change without breaking real users.

Decisions taken with the approved design:

| Decision | Choice |
|---|---|
| Approach | Full adoption; `.pen` is source of truth |
| Editor consumption | Minimal-diff GitHub fork, pinned to release tags, periodic rebase |
| MCP contract | Keep the 6 tool names/scopes; new scene-graph-shaped args; fine-grained ops later |
| Existing design data | Discard (test-workspace only); no converter |

## 2. Architecture

Four components replace the current editor + satori stack:

1. **`apps/estudio` (editor app)** — minimal-diff fork of OpenPencil's web app (Vue), deployed as a third static app on Vercel (same pattern as Hub), embedded in the CRM via iframe at `/estudio/:postId`.
2. **Design doc service** — Node functions on Vercel owning everything that requires `@open-pencil/core`: parse/serialize `.pen`, programmatic scene-graph mutation (AI edits), headless render of frames → JPEG. Replaces the `design-render` edge function chain. Internal-only: callers authenticate with a shared secret header (same pattern as `x-cron-secret`); it verifies nothing else — tenancy/gates/quotas are enforced by the Supabase layer in front of it.
3. **Supabase layer (kept)** — `post_designs` + `design_asset_refs` keep their jobs (rev, doc_hash, staleness, render_status/manifest, asset refcounts, RLS/RPC model). One migration: `doc` jsonb is replaced by a `.pen` blob pointer (`doc_r2_key` text); `doc_hash` becomes a hash of the blob bytes computed by the save endpoint (the jsonb-based trigger is dropped); `is_stale` remains `doc_hash IS DISTINCT FROM rendered_doc_hash`. `post-design-manage` remains the save/load/gate endpoint. Feature gates, quotas, publish gate + cron re-check, media-swap finalize RPC, Hub approval flow: unchanged.
4. **MCP tools** — same six tools (`get_design`, `create_design`, `update_design`, `preview_design`, `get_design_capabilities`, `generate_image`) in the Supabase `mcp` function, which remains the auth/scope/quota/tenancy front door and delegates document operations to the doc service.

Data flow (edit): editor iframe ⇄ `post-design-manage` (auth, gate, rev guard, blob to R2, hash/rev bump) → fire-and-forget → doc service render → JPEGs to R2 → finalize RPC (media links / reel thumbnail) — identical semantics to today with a different renderer.

Data flow (AI): MCP tool call → `mcp` fn (scopes, gates, tenancy, quota) → doc service (load blob → mutate scene graph → serialize) → same save path as above (rev guard included) → render trigger.

## 3. Editor app (`apps/estudio`)

Fork with an **embed mode** entry, keeping the diff small enough to rebase upstream cheaply:

- **Load/save:** document bytes come from `post-design-manage` GET (get-or-create; the starter doc becomes a starter `.pen` with one preset frame derived from post `tipo`); autosave PUTs bytes with `expected_rev`. On 409, keep today's behavior: stash locally, surface conflict banner, offer reload.
- **Chrome removed in embed mode:** local file open/save, desktop/Tauri surfaces, P2P collab (Trystero/Yjs) UI, their built-in BYO-API-key AI chat (our AI goes through MCP + our quota'd endpoints instead).
- **postMessage bridge to CRM:** save status/dirty flag, document title, close request, "open post" deep links.
- **Auth:** served same-origin under our domain via Vercel rewrites, so `supabase-js` in the editor reads the same localStorage session the CRM writes. No tokens in URLs.
- **Brand kit:** brand colors/fonts/logo from the existing `hub-brand` endpoint (`['hub-brand-crm', clienteId]` cache key) mapped into OpenPencil variables + font loading. Fonts must resolve identically in the doc service (shared font manifest → bytes in R2 or bundled).
- **AI image panel:** a small panel (the one deliberate UI addition in the fork) calling the existing `generate-image` edge function — feature gate, burst limit, monthly quota, ledger, R2, audit all unchanged — and inserting the result as an image fill on the selected node or a new node.

## 4. Frames → Instagram mapping

One post = one `.pen` document = one OpenPencil page used as a free canvas. Users add **frames**; frames are the publishable unit.

- **Presets shipped in the fork:** Feed 1:1 (1080×1080), Retrato 4:5 (1080×1350), Capa de Reel 9:16 (1080×1920). A frame is publishable when its aspect ratio matches a preset; export always renders at the preset's pixel size regardless of the frame's on-canvas dimensions.
- **Publishable set:** frames matching a preset. Off-preset frames are permitted (scratch space) but excluded, with a visible badge distinguishing publishable frames.
- **Order:** left-to-right by frame x-position; a numeric prefix in the frame name (e.g. "1 — Capa") overrides.
- **Post `tipo` sync (kept from today, enforced in `post-design-manage` on save):** 1 publishable feed-aspect frame → `feed`; 2+ → `carrossel` (max **10**, the Instagram API carousel limit — validation error above); 9:16 frame on a reel post → cover (design owns only the `is_cover` link; the video stays manual). Carousel frames must share one aspect ratio (Instagram requirement) — mixed aspects are a save-time validation error listing offending frames.
- **Validation** moves from the zod JSON pipeline to a much thinner frame-level check (doc parses, frame count/aspect rules, blob ≤ 2 MB serialized, fonts known). Layer-level validation is delegated to OpenPencil's own model — we no longer own a layer schema.

## 5. Render & publish pipeline

- **Trigger:** every successful save (human or agent) fire-and-forgets to the doc service, same as today's `design-render` trigger. The publish gate re-check and the stuck-render sweep cron keep their logic, pointed at the doc service.
- **Render:** doc service loads the blob, `computeAllLayouts`, exports each publishable frame to JPEG (quality ~90) at 1× preset resolution. Vercel Node functions remove the 2s-CPU chunking constraint — one invocation renders all frames (≤10) with a per-invocation time budget; the manifest format (`[{page_id→frame_id, r2_key, bytes, width, height}]`) is kept.
- **Finalize:** unchanged RPC — replaces `origin='design'` media links in frame order for feed/carrossel, sets `thumbnail_r2_key` for reel covers, orphans previous renders for R2 cleanup, charges file quota.
- **Failure handling:** render errors set `render_status='failed'` with an internal log (never client-detailed); the sweep cron retries; the publish gate continues to block stale/failed designs exactly as today.

## 6. MCP / AI surface

The six tool names, scopes, feature gates, quota checks, audit redaction, and post-status auto-moves are all preserved. What changes is the document payload:

- `get_design` returns a **JSON projection of the scene graph** (frames, nodes, text content, fills, geometry — read-optimized, generated by the doc service) plus render state, instead of the old normalized DesignDoc.
- `create_design` / `update_design` accept a declarative document description (frames + nodes in the same projection shape); the doc service materializes it into a `.pen` scene graph. Full-document replace with `expected_rev`, exactly like today. Fine-grained mutation tools (`set_text`, `swap_image`, …, informed by OpenPencil's own ~90-tool vocabulary) are a later slice, not MVP.
- `preview_design` renders one frame via the doc service and returns an MCP image block (unchanged contract).
- `get_design_capabilities` reports the new format model (frame presets, limits, fonts, brand, feature booleans).
- `generate_image` is untouched.

The `mcp` edge function does no document parsing itself — it forwards validated, tenancy-checked requests to the doc service. Scope names (`designs:write`, `images:generate`, `posts:read`) are unchanged, so `mcp-keys` and the scope registry need no redeploy-wave.

## 7. Deleted vs kept

**Deleted** (after the new path is verified live): `apps/crm/src/pages/estudio/` (~9k LOC), `design-render` fn + `design-render-core.ts` + `design-render-tree.ts` + satori/resvg/mozjpeg deps, `design-doc.ts` zod schema + §2.4 validation pipeline, browser satori renderer + parity fixture, `GerarImagemPanel` (reborn inside the fork). Existing `post_designs` rows are wiped on cutover (test data only).

**Kept:** `post_designs`/`design_asset_refs` tables + triggers + RPC/RLS model (one migration for the blob pointer), `post-design-manage` endpoint shell (gates, tenancy, tipo-sync, media ownership), publish gate + cron re-check, render sweep cron (retargeted), `generate-image` fn + provider adapters (OpenRouter/Gemini), `hub-brand`, `sign-r2-urls`, drawer/gallery ownership surfaces ("Gerenciado pelo Estúdio"), Hub approval flow, feature flags/entitlements/quotas, MCP scope registry.

## 8. Phase 0 spike (gate for everything else)

Three pass/fail proofs, ~2–3 days, throwaway code:

1. **Embed + persistence:** forked app runs in an iframe, loads doc bytes from an HTTP endpoint, autosaves back, file/desktop/collab chrome hidden. *Fail if* persistence requires deep surgery across their app shell rather than an adapter at the IO boundary.
2. **Headless render on Vercel Node:** `@open-pencil/core` + `canvaskit-wasm` renders a 3-frame doc to JPEGs inside a deployed Vercel function within memory/time limits, with custom fonts. *Fail if* WASM init or fonts can't work server-side within Vercel constraints.
3. **Programmatic mutation:** from plain Node, load a `.pen`, set a text node's content, swap an image fill, serialize, re-render — output reflects the edits. *Fail if* the scene-graph API can't express these or serialization round-trips lossily.

Any failure → stop and regroup (fallbacks: different render host for #2; upstream contribution or different embed seam for #1/#3).

## 9. Rollout, testing, risks

- **Rollout:** everything behind the existing `feature_estudio` flag, dark, DK TESTE first — same playbook as v1. No production users are affected at any point.
- **Testing:** doc service gets unit tests for mapping/order/tipo-sync/validation and a render smoke test (golden-image hash per frame preset); `post-design-manage` contract tests updated (Deno suite); MCP tool tests updated to the new payload shapes; one E2E script: MCP `create_design` → render → Hub approval visible. The old satori parity fixture dies with satori.
- **Risks & mitigations:**
  - *Upstream churn (v0.x):* pin release tags; minimal-diff fork; upgrade as deliberate PRs; the doc service pins the same version as the fork so editor and renderer never disagree.
  - *`.pen` format evolution:* a version column on `post_designs` records the OpenPencil version that wrote each blob; the doc service refuses versions newer than it supports (prompting a coordinated upgrade).
  - *Vue-in-React seam:* iframe isolation only; no framework mixing; postMessage contract kept tiny and versioned.
  - *MCP rewrite size:* it's the largest slice; the declarative-projection MVP (not 90 tools) bounds it.
  - *Render output drift between editor (browser CanvasKit) and doc service (Node CanvasKit):* same Skia version pinned via the same package version; golden-image smoke test guards it.
