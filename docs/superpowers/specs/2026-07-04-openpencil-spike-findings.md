# OpenPencil spike findings — 2026-07-04

**Verdict: GO — all three proofs passed**, with one spec amendment (document format) and one bounded gap (emoji in server renders).

| Proof | Result | Evidence |
|---|---|---|
| 1. Embed + persistence | **PASS** | 3 modified files (+21 lines) + 1 new ~50-line module in their app. Verified in browser: HTTP-loaded doc renders → edit → 3s-debounced autosave PUT with `x-expected-rev` → rev 1→4 → stale replay **409** → reload persists the edit → works inside an iframe. |
| 2. Vercel headless render | **PASS** | Deployed scratch fn (gru1): cold 2.9s wall, **warm ~1.0s for 3 frames** (~190ms/frame steady), RSS ~210MB of 1769MB. Output JPEG **byte-identical to local macOS render**. |
| 3. Headless mutate + serialize | **PASS** | Plain Node: create doc → write (30ms) → reload (18ms) → `updateNode` text + image swap → serialize → reload → mutations intact. Frame→JPEG export ~85ms/frame; mutation visibly changes re-render. |

## Spec amendments (design doc §2/§3 updates needed)

1. **The stored blob format is `.fig`, not `.pen`.** In `BUILTIN_IO_FORMATS`, `pen` is a read-only interchange format; `fig` is the native document format with full read/write/export. Everywhere the spec says "`.pen` blob", read "`.fig` blob". (Naming stays internal — the column is a key/pointer either way.)
2. **WYSIWYG parity comes from version pinning, not a parity fixture.** Same pinned `@open-pencil/core` produced byte-identical JPEGs on macOS and Vercel Linux. The fork and the doc service must pin the identical version (already in the spec's risk table; now verified as sufficient).

## API facts the slice plans depend on

All in the published `@open-pencil/core@0.13.2` (npm; subpath exports; only other dep is `canvaskit-wasm@0.41.x`):

```js
// read / write / export
const io = new IORegistry(BUILTIN_IO_FORMATS)                    // from '@open-pencil/core/io'
const { graph } = await io.readDocument({ name, data: bytes })   // bytes: Uint8Array of .fig
const out = await io.writeDocument('fig', graph)                  // → { data, extension }
const jpg = await io.exportContent('jpg',
  { graph, target: { scope: 'node', nodeId: frameId } },
  { format: 'JPG', scale: 1, quality: 90 })                       // → { data } (~85–190ms/frame)
await initCanvasKit()                                             // 25ms local / 777ms Vercel cold
computeAllLayouts(graph)                                          // from '@open-pencil/core/layout' — after load/mutation

// scene graph (from '@open-pencil/core/scene-graph')
graph.addPage(name); graph.getPages(); graph.getChildren(id); graph.getNode(id)
graph.createNode('FRAME'|'TEXT'|'RECTANGLE'|..., parentId, overrides)
graph.updateNode(id, changes)          // THE mutation API (text, fills, geometry…)
graph.images                           // Map<sha1hex, Uint8Array> — imageHash on fills MUST be hex
// text fields: text, fontFamily, fontWeight, fontSize, styleRuns, textAlignHorizontal

// fonts (from '@open-pencil/core/text') — offline & deterministic:
fontManager.markLoaded(family, styleName, arrayBuffer)  // styleName via weightToStyle(weight)
// register EVERY (family, style) the doc uses BEFORE export, else network fallback (Google Fonts)
```

Gotchas: the `.fig` writer injects a default empty "Page 1" (find content page by name); a rejected module-scope init promise on Vercel = opaque exit 128 (init lazily in the handler); `canvaskit.wasm` needs `includeFiles` in `vercel.json` (not statically traced).

## Fork seam (probe branch `spike/embed` in `~/Projects/open-pencil-spike`)

- `src/app/embed/index.ts` (new): embedConfig from `?embed=1&docUrl=`, fetch→`File`, PUT with `x-expected-rev`, chrome CSS.
- `src/app/document/io/source.ts`: `saveToEmbed()` + autosave `hasWritableSource`/`saveCurrentDocument` branches (~10 lines).
- `src/app/editor/session/modules.ts`: boot-load embedded doc, enable autosave, probe handle (~6 lines).
- `src/main.ts`: `installEmbedChrome()` (2 lines).
- Their IO layer (`src/app/document/io/`, 16 files / 716 LOC) is cleanly factored — the seam is stable-looking; upstream-rebase risk is modest.
- Fork-slice TODOs the probe surfaced: `v-if` the menubar/Share/collab chrome (no stable CSS hooks), focus the content page on boot, disable the "Automation" RPC websocket in embed mode, clone with `GIT_LFS_SKIP_SMUDGE=1` (their LFS backend rejects anonymous pulls; objects are test fixtures only), dev needs Node ≥20.12 or `bun --bun`.

## Known gap — emoji in headless renders

Headless render draws "NO GLYPH" boxes for emoji (their font fallbacks cover only `cjk`/`arabic`; no OS emoji font server-side). Editor-side is fine (browser/system fonts). Bounded fixes for the doc-service slice, in preference order: register a color-emoji font and wire it into the paragraph fallback chain (possibly upstreaming an `'emoji'` `FontFallbackScript` — repo is very active), or port v1's twemoji substitution. **Must be resolved in the doc-service slice — Instagram content is emoji-heavy.**

## Surprises / notes

- The npm package is fully self-contained for server work — the doc service needs no fork, just `@open-pencil/core` + `canvaskit-wasm`.
- Our headless-created doc opened pixel-correct in their editor (write→read through the real app) — the AI/MCP write path and the editor read path already agree.
- Team Vercel projects get SSO Deployment Protection by default — the real doc service needs protection off + its own shared-secret auth (same `x-cron-secret` pattern as today).

## Go/No-Go recommendation

**GO.** Every load-bearing assumption held, mostly with margin: the embed seam is a 4-file, ~70-line change against a cleanly-factored IO layer; server render is fast (~1s warm for a 3-frame carousel), cheap (~210MB), and bit-exact across platforms; programmatic document manipulation is a first-class public API. The emoji gap is real but bounded and must simply be a hard requirement of the doc-service slice.

## Cleanup ledger

- [ ] `spike/openpencil/` deleted before the first slice PR
- [x] Vercel project `op-spike-render` deleted (2026-07-04, after findings recorded)
- [ ] `~/Projects/open-pencil-spike` kept — becomes the fork slice's starting point (branch `spike/embed` holds the probe commit)
