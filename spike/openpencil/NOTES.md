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
