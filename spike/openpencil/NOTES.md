# OpenPencil spike — running notes

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
