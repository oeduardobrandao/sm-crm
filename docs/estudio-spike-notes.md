# OpenPencil spike — running notes

## Slice B (MCP rewrite) — 2026-07-05, deployed + live-verified on prod

MCP design tools v2 live (DK TESTE, scratch keys created+revoked in-page): create_design
standalone (design 3, starter projection) → update_design ops rev 2 (set_fill + add_text
"MCP V2 AO VIVO 🔥", stable node ids) → render kept pace → attach_design → post 1041
(media applied; get_design signs the post's design links — finalize leaves NO manifest for
attached designs, manifest fallback covers unattached) → preview_design 32KB JPEG image
block → bad op → structured node_not_found. get_design_capabilities documents the ops
vocabulary. Scopes unchanged; the session's cached MCP connector schemas were STALE after
redeploy (drive E2E via raw JSON-RPC in-page; reconnect the connector for new tools).
Gotchas: mcp-keys fn wants {action:'create'|'list'|'revoke'}; preview_eval hard-times-out
at 30s (no long sleeps — but the in-page script keeps running and its `finally` cleanup
still executes); page reloads wipe window state between evals (use sessionStorage or
single-eval flows).

## B-prep (doc service) — 2026-07-04, deployed + live-smoked

mesaas-estudio-render grew the headless doc endpoints for the MCP slice:
`POST /api/describe` (.fig bytes → scene projection; node ids = source.id guids, STABLE
across saves — graph-internal ids are NOT) and `POST /api/mutate` (MDF1 binary frame
{ops}+bytes → frame {projection,applied}+new bytes; 9 ops, all-or-nothing coded 422s;
ensureExportSafeGuids pre-write). Live: describe 95ms, mutate 230ms on the feed starter —
set_fill + add_text applied, untouched ids stable, invalid op → 422 node_not_found.
MCP update_design = fetch blob → /api/mutate → save RPC; get_design = /api/describe.

## Slice 4 (CRM shell) live verification — 2026-07-04, local CRM against prod

`/estudio/1041` in the local CRM (npm run dev :5174 + fork dev server :1420) ran the FULL
loop: iframe boot → bridge ready → auth over postMessage → GET blob through the Vite dev
proxy (`/estudio-fn`, OPTIONS 204 + CORS echo) → doc:loaded → editor UI with pages/layers/
frames → forced save rev 7 → external stale-making PUT → editor save → **409 → CONFLITO
pill + banner** → Recarregar → fresh boot at rev 8 → autosave rev 9 → Salvo. Row ended
rev 9 / rendered / not stale — design-render re-fired on every PUT.
Gotchas: (1) the editor emits `dirty` + a no-op autosave PUT right after every open
(sceneVersion drifts from savedVersion during load/layout) → one wasted render per open;
fork fix = re-init savedVersion after open settles. (2) The embed client does NOT send
x-editor-version (rows have editor_version null) — add to fork backlog. (3) First
screenshot mid-boot shows a pencil splash + empty canvas: dev-mode module streaming into
the iframe takes ~10s; not a bug. (4) canvaskit-webgpu vendor warning at fork dev startup
is benign — the app falls back to /canvaskit.wasm from node_modules.

## Slice 3 (doc service) live verification — 2026-07-04, prod

Post 1041, full pipeline: PUT 1-frame doc ("ESTÚDIO V2 🔥") → rev 4 → design-render claimed →
estudio-render service → rendered JPEG 1080×1350 with COLOR EMOJI visible → finalize swapped
origin='design' link → render_status rendered / is_stale false. Then PUT 2-frame doc → rev 5 →
2 ordered links → **tipo auto-flipped feed→carrossel** (frame-derived sync). Sanitized-failure
path also proven live: an invalid doc (no publishable frames) → render_error "Nenhum frame com
proporção 1:1, 4:5 ou 9:16." and no uploads.
**GOTCHA SOLVED (2026-07-04, B-prep):** the "write-after-read loses frames" bug is a guid
collision in @open-pencil/core's fig exporter — new-node guids mint as {sessionID:1,
localID:counter++} but the counter is only seeded past imported session-0 ids; content
nodes from a previous export live in session 1, so the first node CREATED on an imported
doc steals an existing guid and re-import drops its owner (pure read→write and
updateNode-only round-trips are SAFE). Fixed in the fork (5d01d6f, export.ts scans all
sessions — protects the interactive editor too) and worked around in the npm-pinned
service via ensureExportSafeGuids(graph) (lib/guids.js: assign source.ids to created
nodes pre-write). Baseline test in test/guids.test.js flags when a fixed core version
lands.
Vercel service: mesaas-estudio-render.vercel.app (bearer auth, SSO off), cold 1.8s/warm 1.0s.
supabase secrets CLI: --env-file only accepts RELATIVE paths (absolute → "node: not found").

## Slice 2 (endpoint) live verification — 2026-07-04, prod

Post 1041 (DK TESTE, feed, rascunho), all from the CRM page origin with the real user token:
GET /blob minted the feed starter (200, x-rev 1, 29,184 bytes, ZIP magic — .fig container) →
PUT at rev 1 (x-editor-version 0.13.2) → 200 x-rev 2 → stale replay → **409 rev_conflict** →
GET → rev 2 persisted through R2 → unauth GET → 401. Row: rev 2, doc_r2_key
designs/{conta}/1041-r2.fig, sha256 hash, editor_version recorded, render_status pending +
is_stale true (renderer = doc-service slice). Prod ALLOWED_ORIGINS covers localhost:5174.
**CRM-shell slice TODO:** editor dev origin (localhost:1420) is NOT in prod ALLOWED_ORIGINS —
either add it or dev-proxy the blob route through the CRM origin. Vite ignores the preview
harness's assigned PORT (grabs 5174 when 5173 busy) — navigate the preview manually.

Package: `@open-pencil/core@0.13.2` (npm, bundles scene-graph/io/layout/text/tools as subpath exports). Node v20.11.1.

## API facts (from published .d.ts, verified by probes below)

**IO** (`@open-pencil/core/io`):
- `new IORegistry(BUILTIN_IO_FORMATS)`
- `io.readDocument({ name, data: Uint8Array })` → `Promise<{ graph: SceneGraph, ... }>`
- `io.writeDocument(formatId, graph, options?)` → `Promise<ExportResult>` (`{ data, extension }`)
- `io.exportContent(formatId, { graph, target }, options?)` → `Promise<ExportResult>`; `target = { scope: 'node', nodeId } | { scope: 'page', pageId }`; raster options `{ format: 'JPG'|'PNG'|'WEBP', scale, quality }`
- `initCanvasKit(): Promise<CanvasKit>` (from `io/formats/raster/headless`, re-exported by `io`)

**SceneGraph** (`@open-pencil/core/scene-graph`):
- `new SceneGraph()`; `addPage(name)` → page node; `getPages()`; `getChildren(id)`; `getNode(id)`; `flattenTree()`
- `createNode(type, parentId, overrides: Partial<SceneNode>)` — types incl. `'FRAME' | 'TEXT' | 'RECTANGLE' | 'ELLIPSE' | ...`
- `updateNode(id, changes: Partial<SceneNode>)` — THE mutation API
- `graph.images: Map<string, Uint8Array>` — image bytes by hash; fills reference via `imageHash`
- SceneNode text fields: `text`, `fontSize`, `fontFamily`, `fontWeight`, `styleRuns`, `textAlignHorizontal`, `textAutoResize`
- `Fill = { type: 'SOLID'|'IMAGE'|'GRADIENT_*'|..., color: {r,g,b,a} (0..1), opacity, visible, imageHash?, imageScaleMode? }`

**Fonts** (`@open-pencil/core/text`):
- singleton `fontManager: FontManager`
- `fontManager.markLoaded(family, style, data: ArrayBuffer)` — register font bytes manually (headless path)
- `fontManager.attachProvider(canvasKit, provider)`; `ensureNodeFont(family, weight)`; google-fonts fetch fallback exists (`loadFont`) — network!
- `weightToStyle(weight, italic?)` maps 700 → style name

**Layout** (`@open-pencil/core/layout`): `computeAllLayouts(graph)` after load/mutation, before export.

## Probe results

### 01-roundtrip.mjs — PASS (Proof 3a)

- **CRITICAL FORMAT DISCOVERY:** in `BUILTIN_IO_FORMATS`, `.pen` is `interchange-document`, **read-only** (`readDocument` only — it's their design-as-code/JSON-ish interchange). The **native round-trippable document format is `.fig`** (`native-document`, full read+write+export). → **Spec amendment: the stored blob is `.fig`, not `.pen`.** Fixture is `fixtures/sample.fig`.
- `io.writeDocument('fig', graph)` → 29,715 bytes for 3 frames + text + 1x1 image; **write 30ms, reload 18ms**, graph build <1ms.
- `imageHash` MUST be a hex digest (writer calls `hexToBytes`); Figma-style sha1-of-bytes works. Image swap = add bytes under new sha1 + `updateNode(rectId, {fills: [{...fill, imageHash: newHash}]})`.
- The .fig writer/reader injects a default empty "Page 1"; our content page must be found by name, not index.
- Mutations verified persisted across serialize/reload: `updateNode(textId, {text})`, image swap, both re-read correctly.

### embed probe — PASS (Proof 1)

- **Diff footprint: 3 modified files (+21 lines) + 1 new module (~50 lines)** in their repo (branch `spike/embed` in `~/Projects/open-pencil-spike`, local commit): `src/app/embed/index.ts` (new), `src/app/document/io/source.ts` (embed save + autosave gate), `src/app/editor/session/modules.ts` (boot-load + probe handle), `src/main.ts` (chrome CSS). FAR under the ≤10-file fail bar.
- Their IO layer is cleanly seamed: `src/app/document/io/` (16 files, 716 LOC) — `openFigFile(File)` for load, `buildFigFile()→bytes` for save, `createAutosave` (3s debounce on `state.sceneVersion`, gated by `hasWritableSource()`), `autosaveEnabled` default false (embed turns it on).
- Verified end-to-end in the browser: doc served by HTTP stub loads at boot → renders our headless-created frames (write→read through their real app!) → graph edit → autosave PUT with `x-expected-rev` → stub rev 1→4 → stale-rev replay gets **409** → page reload shows the persisted edit. Also verified **inside an iframe**.
- Editor-side text render matches the frames built in Node (same "ANTES" layout) — visual parity editor↔headless observed on the probe doc.
- Gotchas for the fork slice:
  - Repo uses **git-lfs with a custom R2 endpoint that rejects anonymous downloads** — clone with `GIT_LFS_SKIP_SMUDGE=1` (LFS objects are test fixtures only; app builds/runs without them).
  - Dev needs **Node ≥20.12** (vite config uses `util.styleText`) or run `bun --bun run dev`.
  - Their dev app opens on the default empty "Page 1" — embed boot should focus the content page.
  - Chrome hiding: no stable class hooks (tailwind utilities) — fork should `v-if` the menubar/Share/collab components on embedConfig; probe hid `[role=menubar]` via CSS.
  - An "Automation" websocket (their CLI/MCP app-RPC) retries in a loop in dev — disable in embed mode.
  - Cross-origin iframe triggered a `localStorage` SecurityError (unhandled) once under partitioned storage; app still booted. Production embed is same-origin (Vercel rewrites) so moot — but worth guarding upstream.
  - `packages/mcp` fails module resolution in dev from the repo (needs workspace build) — irrelevant to the editor app.

### 02-export.mjs — PASS (Proof 3b)

- `initCanvasKit()`: **25ms** in plain Node (wasm bundled in canvaskit-wasm pkg, no locateFile needed).
- Frame exports (1080×1080, JPG q90): **~85ms/frame** warm; first export 336ms (includes per-family font resolution). Visual output verified: real bold Inter glyphs, correct wrap/clip, image fill painted.
- **Fonts:** `fontManager.markLoaded(family, styleName, arrayBuffer)` BEFORE export = fully offline + deterministic. Must register every (family, style) the doc uses — style names via `weightToStyle(weight)` ('Regular', 'Bold', ...). If a style is missing they fall back to network (Google Fonts fetch — 6.8s first export when we let it) and a broken `fetchBundledFont` path (ERR_PACKAGE_PATH_NOT_EXPORTED in Node — non-fatal noise). Render was byte-identical between our repo TTF and their Google-fetched copy.
- Mutation-visibility: text change → re-export → bytes differ, text visibly updated. ✔
### vercel-render — PASS (Proof 2)

- Deployed to scratch project `op-spike-render` (region gru1, Node v24.14.1, 1769MB/60s config).
- **Cold: 2.9s wall** (canvaskit init 777ms + first-frame 900ms + overhead). **Warm: ~1.0s for all 3 frames** (~580/188/187ms per frame). **RSS ~200–218MB** — nowhere near the limit.
- **Rendered JPEG is BYTE-IDENTICAL to the local macOS render** (`cmp` clean). Pinning `@open-pencil/core` gives deterministic cross-platform output — the WYSIWYG parity the v1 satori fixture guarded now comes from version pinning.
- Deploy gotchas (for the doc-service slice):
  1. `canvaskit.wasm` is loaded dynamically → NOT traced by Vercel's bundler → `includeFiles: "{assets,node_modules/@open-pencil/core/node_modules/canvaskit-wasm/bin/full,node_modules/canvaskit-wasm/bin/full}/**"` required. Without it the fn dies with exit 128 (Emscripten abort) and NO stack in logs.
  2. A module-scope init promise that rejects = opaque exit 128; lazy-init inside the handler with try/catch made the real error visible. Doc service should init lazily and return structured errors.
  3. Team default Deployment Protection (SSO) intercepts requests (302) — scratch project needed `ssoProtection: null` via API. The real doc service wants protection OFF + its own shared-secret header auth.
- **KNOWN GAP — emoji:** headless render shows a "NO GLYPH" box for emoji (`out/emoji.jpg`). Their fallback scripts are only `'cjk' | 'arabic'` (no emoji), and headless has no OS emoji font. Mitigations for the doc-service slice: register a color-emoji font and wire it into the fallback chain (possibly upstream a `'emoji'` FontFallbackScript — they're active), or reuse v1's twemoji-substitution idea. Editor-side emoji rendering to be sanity-checked in Task 4 (browser has system fonts).

## Design-first core (slice A1, 2026-07-04) — implementation notes

- `designs` replaces `post_designs` wholesale (rows were dark test data). Migration
  `20260705000001_designs_first_class.sql` was validated by EXECUTING it against a throwaway
  local Postgres 14 (homebrew initdb in a scratch dir, prod-shape stubs) plus a behavioral
  RPC suite — cheap and caught a real plpgsql bug (record-field access on an unassigned
  record when a design is unattached; plpgsql does NOT short-circuit `AND`).
- Lock-ordering flip: v1 locked workflow_posts → post_designs (safe because post_id was
  immutable). With attach/detach, post_id is only authoritative under the designs-row lock,
  so the whole v2 family (save/attach/finalize) locks designs FIRST, then the post.
- Stored-manifest lifecycle: unattached finalizes keep render_manifest on the rendered row
  (future gallery thumbnails). claim_design_render reaps ANY non-null manifest at reclaim
  (v1 reaped only superseded 'rendering') — otherwise the previous unattached render's R2
  keys leak when a new render is claimed. delete_design queues doc blob + stored manifest
  into file_deletions in the same transaction.
- Blob keys are uuid-keyed now (`designs/{conta}/{uuid}-r{rev}.fig`) — POST /designs can't
  know the row id before insert, and decoupling keys from ids removes the create-race
  entirely.
- `livre` starter = page with NO frame. design-render maps livre → 'carrossel' service mode
  when unattached (multi-frame-tolerant); an empty livre canvas fails validation and shows a
  gallery placeholder (accepted for A1).

## Estúdio home + read-only (slice A2, 2026-07-05) — implementation notes

- Zero backend changes — the whole slice consumed A1's routes/RLS as designed. Gallery
  thumbnails: stored render_manifest (unattached) / design-origin cover link (attached) /
  video thumbnail_r2_key (attached reel_cover), signed in one resolveInlineImageUrls batch.
- Fork `readOnly=1` (open-pencil-spike@5a4ae95): embedConfig.readOnly → HAND tool locked
  after doc load, autosave off, bridge 'save' ignored, no dirty events, toolbar hidden,
  keyboard bindings skipped, dblclick/contextmenu neutralized via capture listeners. Live
  E2E proved zero PUTs from a read-only session (write mode autosaves ~3s post-load).
  Config parsing extracted to embed/config.ts (pure, bun-testable — index.ts touches
  window at module scope). Fork engine suite: 66 pre-existing failures = LFS fixtures
  skipped at clone (GIT_LFS_SKIP_SMUDGE), identical before/after — compare against a
  stashed baseline, not zero.
- E2E harness gotchas (new): Radix triggers ignore synthetic PointerEvents AND CDP
  preview_click — invoke the trigger's __reactProps onPointerDown({button:0, pointerType:
  'mouse'}) directly, then plain MouseEvent('click') on items (pointerup+click BOTH select
  → double-fire; we got a duplicate design that way). Drawer TIPO/STATUS are NATIVE
  selects — but status changes FROM approved statuses open a confirm dialog
  (pendingStatusChange) — click 'Confirmar'. The preview harness periodically re-navigates
  its tab to the assigned port: do whole flows in ONE eval, re-establish state at the top.
  Narrow preview viewport = mobile layout (bottom nav, '#/' hrefs) — preview_resize to
  desktop first.
- Prod test residue (DK TESTE): designs 1/2/3 attached to posts 1113/971/1041, design 5
  detached ('A1 standalone E2E (cópia)'); posts 1114/1115 ('Post 2'/'Post 3', rascunho)
  created for the apply E2E — drawer trash deletion didn't take via synthetic events,
  left as test data.

## Slice D — cutover (2026-07-06)

- Satori legacy deleted end-to-end (−7.4k LOC): the module web reached further than the
  functions dir — root `test/` vitest mirrors, `scripts/fonts/` tooling, `fonts:build`
  script and `@mesaas/design-doc`+`@mesaas/fonts` aliases (the CRM one dead since the v1
  editor deletion). Sweep greps must be repo-wide, not app-dir-scoped.
- Editor went live at https://estudio.mesaas.com.br: `mesaas.com.br` is registered in the
  same Vercel team with Vercel nameservers, so `vercel domains add` provisioned DNS+cert
  in one step, no registrar work. Vercel deployment protection turned out to be a non-issue
  for custom domains — it only gates `*.vercel.app` URLs.
- The CRM's REAL production origin is `www.mesaas.com.br` (apex 307-redirects to www; the
  planning shorthand "app.mesaas.com" never existed). CSP `frame-ancestors` carries
  mesaas.com.br + www + sm-crm.vercel.app.
- PR #187 (99 commits, 288 files) merged as a SQUASH (d90be77) — tree verified identical
  to the branch head (`git diff origin/main <branch> --stat` empty). Prod↔repo drift over.
- Deployed-app E2E (www.mesaas.com.br): /estudio gallery + create + card menu + delete all
  work; deleted-design rows disappear from RLS reads immediately. The editor iframe boots
  from the prod origin (embed=1, CSP framing OK) and fails exactly at the doc fetch until
  the editor origin lands in ALLOWED_ORIGINS — the shell's load-error screen (not an
  eternal spinner) renders as designed.
- Workspace isolation seen live: a session on another workspace sees an EMPTY gallery
  (RLS), and Eduardo's own workspace has feature_estudio enabled — the flag's blast radius
  is real-team-visible, not just DK TESTE.
