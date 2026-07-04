# Estúdio v2 — Phase 0 OpenPencil Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove (or kill) the three load-bearing assumptions of the OpenPencil adoption — headless document mutation/serialization, headless JPEG render inside a deployed Vercel Node function, and embeddable editor with custom persistence — ending in a committed findings doc and a go/no-go decision.

**Architecture:** Throwaway probe scripts in `spike/openpencil/` (committed for reproducibility, deleted before the first real slice PR) exercise the published `@open-pencil/core` package headlessly; a scratch Vercel project proves server-side render limits; a local clone of the OpenPencil repo at the pinned tag proves the embed/persistence seam. No task touches Supabase, prod Vercel projects, or client data.

**Tech Stack:** Node ≥ 20, `@open-pencil/core@0.13.2` (verified on npm; bundles scene-graph/io/layout/tools as subpath exports), `canvaskit-wasm`, Vercel CLI, bun (their repo's package manager), OpenPencil repo tag `v0.13.2`.

## Global Constraints

- OpenPencil version is pinned to **0.13.2** everywhere (npm packages AND the repo clone tag). Never mix versions between probes.
- Spike code lives in `spike/openpencil/` on branch `feat/estudio-openpencil`; commit it, but it MUST be deleted before the first real slice PR (tracked in findings doc).
- The OpenPencil repo clone lives OUTSIDE this repo at `~/Projects/open-pencil-spike` and is never committed here.
- Scratch Vercel project name: `op-spike-render`. Delete it in Task 5. Never deploy to the existing production Vercel project.
- No Supabase reads/writes, no R2, no client data. The custom-font probe uses `public/fonts/estudio/archivo-black/400-normal.latin.ttf` from this repo.
- Every probe script is its own test: it `assert`s its pass criteria and exits non-zero on failure. "Run and see PASS printed" is the test cycle.
- Each proof's FAIL condition is a hard stop: record findings, do not continue to later tasks, report back for the regroup decision (fallbacks are listed in the spec §8).

---

### Task 1: Headless load → mutate → serialize round-trip (Proof 3, part 1)

The cheapest kill-shot. If plain Node cannot load a `.pen`, change a text node, swap an image, and serialize back losslessly, the doc service concept dies and with it the architecture.

**Files:**
- Create: `spike/openpencil/package.json`
- Create: `spike/openpencil/fixtures/sample.pen` (made by hand in their web app)
- Create: `spike/openpencil/01-roundtrip.mjs`
- Create: `spike/openpencil/NOTES.md` (running log of discovered API facts; feeds Task 5)

**Interfaces:**
- Produces: `fixtures/sample.pen` — a document with exactly 3 frames named `1 - Capa`, `2 - Meio`, `3 - CTA` (1080×1080 each), where frame `1 - Capa` contains a text node with content `ANTES` and an image-filled rectangle. Every later task loads this file.
- Produces: `NOTES.md` — documented answers to: how a `SceneGraph` is traversed/queried, how text content is set, how an image fill's bytes are swapped, how a graph serializes to `.pen` bytes.

- [ ] **Step 1: Create the fixture document in their web app**

Open https://app.openpencil.dev, create a new document. Add three 1080×1080 frames named exactly `1 - Capa`, `2 - Meio`, `3 - CTA` (left to right). In `1 - Capa`: add a text node with content `ANTES`, and a rectangle with any JPEG/PNG image fill (drag any image in). Save/download as `.pen` → store at `spike/openpencil/fixtures/sample.pen`.

(If the hosted app is unavailable, defer this step: clone + run the repo app first via Task 4 Step 1 and create the fixture locally — the fixture is what matters, not where it was made.)

- [ ] **Step 2: Scaffold the spike package**

```json
// spike/openpencil/package.json
{
  "name": "op-spike",
  "private": true,
  "type": "module",
  "dependencies": {
    "@open-pencil/core": "0.13.2",
    "canvaskit-wasm": "0.41.1"
  }
}
```

Run: `cd spike/openpencil && npm install`
Expected: installs clean on Node ≥ 20 (`node --version` first).

- [ ] **Step 3: Discover the load/serialize/mutation API surface**

The published package ships type declarations — read them instead of guessing:

```bash
grep -n "readDocument\|writeDocument\|exportContent\|serialize" node_modules/@open-pencil/core/dist/io/index.d.ts | head -30
grep -n "class SceneGraph\|getPages\|findAll\|setText\|characters\|updateNode" node_modules/@open-pencil/core/dist/scene-graph/index.d.ts | head -40
```

Known-good anchors from their CLI source (verified on the repo): `IORegistry`, `BUILTIN_IO_FORMATS`, `initCanvasKit` come from `@open-pencil/core/io`; `computeAllLayouts` from `@open-pencil/core/layout`; reading is `io.readDocument({ name, data: Uint8Array })` → `{ graph }`. Record in `NOTES.md`: the write/serialize call, the node-query API, the text-set API, the image-fill API. If any of the four is absent from the public API, that is a **FAIL for Proof 3** — stop and report.

- [ ] **Step 4: Write the round-trip probe**

```js
// spike/openpencil/01-roundtrip.mjs
import { readFile, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { BUILTIN_IO_FORMATS, IORegistry, initCanvasKit } from '@open-pencil/core/io'
import { computeAllLayouts } from '@open-pencil/core/layout'

const io = new IORegistry(BUILTIN_IO_FORMATS)
await initCanvasKit() // adjust args per Step 3 discovery (e.g. locateFile → node_modules path)

console.time('load')
const bytes = new Uint8Array(await readFile('fixtures/sample.pen'))
const { graph } = await io.readDocument({ name: 'sample.pen', data: bytes })
computeAllLayouts(graph)
console.timeEnd('load')

// -- query: find the 3 frames and the ANTES text node (API per Step 3 discovery) --
const frames = /* discovered query API, e.g. */ graph.getPages()[0].children.filter(n => n.type === 'FRAME')
assert.equal(frames.length, 3, 'expected 3 frames')
assert.deepEqual(frames.map(f => f.name).sort(), ['1 - Capa', '2 - Meio', '3 - CTA'])

const textNode = /* discovered text query, scoped to frame '1 - Capa' */ null
assert.ok(textNode, 'text node found')

// -- mutate: text + image swap (API per Step 3 discovery) --
/* set text content to 'DEPOIS' */
/* swap the image fill bytes for fixtures replacement (any second image) */

// -- serialize → reload → verify persistence --
const outBytes = /* discovered write API, e.g. await io.writeDocument('pen', { graph }) */ null
await writeFile('out/roundtrip.pen', outBytes)

const { graph: graph2 } = await io.readDocument({ name: 'roundtrip.pen', data: new Uint8Array(await readFile('out/roundtrip.pen')) })
const text2 = /* same text query on graph2 */ null
assert.equal(/* text content of text2 */ null, 'DEPOIS', 'mutation survived serialize/reload')
console.log('PASS: headless load/mutate/serialize round-trip')
```

The three `/* discovered */` sites are filled from Step 3's `NOTES.md` — everything else (imports, flow, assertions) is final. Add `spike/openpencil/out/` to `spike/openpencil/.gitignore` along with `node_modules/`.

- [ ] **Step 5: Run the probe**

Run: `mkdir -p out && node 01-roundtrip.mjs`
Expected: `PASS: headless load/mutate/serialize round-trip` + load timing printed. Non-zero exit or a missing API = **Proof 3 FAIL** → stop, record in NOTES.md, report.

- [ ] **Step 6: Commit**

```bash
git add spike/openpencil/package.json spike/openpencil/01-roundtrip.mjs spike/openpencil/NOTES.md spike/openpencil/.gitignore spike/openpencil/fixtures/sample.pen
git commit -m "spike(estudio-v2): proof 3a — headless .pen round-trip in plain Node"
```

---

### Task 2: Headless JPEG export of frames (Proof 3, part 2 + render-core dry run)

**Files:**
- Create: `spike/openpencil/02-export.mjs`
- Modify: `spike/openpencil/NOTES.md`

**Interfaces:**
- Consumes: `fixtures/sample.pen`, the query API documented in `NOTES.md` by Task 1.
- Produces: documented per-frame export call + timings in `NOTES.md`; the exact `exportFrameToJpeg(graph, nodeId)` incantation Task 3 wraps in a Vercel function.

- [ ] **Step 1: Write the export probe**

Verified anchor from their CLI `export.ts`: `io.exportContent(formatId, { graph, target }, options)` where `target = { scope: 'node', nodeId }` and `options = { format: 'JPG', scale: 1, quality: 90 }`, returning `{ data, extension }`.

```js
// spike/openpencil/02-export.mjs
import { readFile, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { BUILTIN_IO_FORMATS, IORegistry, initCanvasKit } from '@open-pencil/core/io'
import { computeAllLayouts } from '@open-pencil/core/layout'

const io = new IORegistry(BUILTIN_IO_FORMATS)
console.time('canvaskit-init')
await initCanvasKit()
console.timeEnd('canvaskit-init')

const bytes = new Uint8Array(await readFile('fixtures/sample.pen'))
const { graph } = await io.readDocument({ name: 'sample.pen', data: bytes })
computeAllLayouts(graph)

const frames = /* frame query from NOTES.md */ []
assert.equal(frames.length, 3)

for (const frame of frames) {
  console.time(`export ${frame.name}`)
  const result = await io.exportContent('jpg', { graph, target: { scope: 'node', nodeId: frame.id } }, { format: 'JPG', scale: 1, quality: 90 })
  console.timeEnd(`export ${frame.name}`)
  const jpeg = result.data
  assert.ok(jpeg[0] === 0xff && jpeg[1] === 0xd8 && jpeg[2] === 0xff, `${frame.name}: JPEG magic bytes`)
  assert.ok(jpeg.length > 10_000, `${frame.name}: plausible size (${jpeg.length} bytes)`)
  await writeFile(`out/${frame.name.replaceAll(' ', '_')}.jpg`, jpeg)
}
console.log('PASS: 3 frames exported as JPEG')
```

- [ ] **Step 2: Run it and eyeball the output**

Run: `node 02-export.mjs && open out/1_-_Capa.jpg`
Expected: `PASS`, three JPEGs that visually match the frames (text `DEPOIS`-era doc is fine — content match matters, not which fixture era). Record init + per-frame ms in `NOTES.md`. Text rendering as tofu/blank = font handling problem → investigate whether `.pen` embeds fonts or a registration API exists (grep `font` in `dist/io/index.d.ts` + `dist/text/index.d.ts`), record findings; unresolvable = **Proof 3 FAIL**.

- [ ] **Step 3: Mutation-visibility check**

Append to `02-export.mjs`: set the `1 - Capa` text to `RENDER-CHECK` (mutation API from NOTES.md), re-export that frame, assert the new JPEG bytes differ from the first export (`Buffer.compare !== 0`), write to `out/mutated.jpg`, eyeball that the text visibly changed.

Run: `node 02-export.mjs && open out/mutated.jpg`
Expected: `PASS`, text visibly reads `RENDER-CHECK`.

- [ ] **Step 4: Commit**

```bash
git add spike/openpencil/02-export.mjs spike/openpencil/NOTES.md
git commit -m "spike(estudio-v2): proof 3b — headless frame→JPEG export with timings"
```

---

### Task 3: Render inside a deployed Vercel Node function (Proof 2)

**Files:**
- Create: `spike/openpencil/vercel-render/package.json`
- Create: `spike/openpencil/vercel-render/api/render.mjs`
- Create: `spike/openpencil/vercel-render/vercel.json`
- Copy in: `spike/openpencil/vercel-render/assets/sample.pen`, `assets/brand-font.ttf` (from `public/fonts/estudio/archivo-black/400-normal.latin.ttf`)
- Modify: `spike/openpencil/NOTES.md`

**Interfaces:**
- Consumes: the working export incantation from Task 2 (verbatim), fixture + font assets.
- Produces: measured cold/warm numbers in `NOTES.md` — the go/no-go data for "doc service on Vercel".

- [ ] **Step 1: Scaffold the scratch Vercel project**

```json
// spike/openpencil/vercel-render/package.json
{
  "name": "op-spike-render",
  "private": true,
  "type": "module",
  "dependencies": {
    "@open-pencil/core": "0.13.2",
    "canvaskit-wasm": "0.41.1"
  }
}
```

```json
// spike/openpencil/vercel-render/vercel.json
{ "functions": { "api/render.mjs": { "memory": 1769, "maxDuration": 60 } } }
```

- [ ] **Step 2: Write the render endpoint**

```js
// spike/openpencil/vercel-render/api/render.mjs
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BUILTIN_IO_FORMATS, IORegistry, initCanvasKit } from '@open-pencil/core/io'
import { computeAllLayouts } from '@open-pencil/core/layout'

let initMs = null
const ready = (async () => {
  const t = Date.now()
  await initCanvasKit() // if it takes a locateFile/wasm-path option (per Task 1 discovery), point it at node_modules/canvaskit-wasm/bin
  initMs = Date.now() - t
})()

export default async function handler(req, res) {
  await ready
  const t0 = Date.now()
  const dir = join(process.cwd(), 'assets')
  const bytes = new Uint8Array(await readFile(join(dir, 'sample.pen')))
  const io = new IORegistry(BUILTIN_IO_FORMATS)
  const { graph } = await io.readDocument({ name: 'sample.pen', data: bytes })
  computeAllLayouts(graph)
  // font registration only if Task 2 found it necessary — same call here, bytes from join(dir, 'brand-font.ttf')

  const frames = /* frame query from NOTES.md */ []
  const perFrame = []
  const sizes = []
  for (const frame of frames) {
    const t = Date.now()
    const r = await io.exportContent('jpg', { graph, target: { scope: 'node', nodeId: frame.id } }, { format: 'JPG', scale: 1, quality: 90 })
    perFrame.push(Date.now() - t)
    sizes.push(r.data.length)
  }
  res.status(200).json({
    coldInit: initMs, totalMs: Date.now() - t0, perFrameMs: perFrame, jpegBytes: sizes,
    rssMB: Math.round(process.memoryUsage().rss / 1e6),
    node: process.version,
    sample: Buffer.from((await io.exportContent('jpg', { graph, target: { scope: 'node', nodeId: frames[0].id } }, { format: 'JPG', scale: 1, quality: 90 })).data).toString('base64').slice(0, 100) + '…'
  })
}
```

Include a `?full=1` branch that returns the first frame as an actual `image/jpeg` response body so correctness is verifiable in a browser tab, not just by byte counts.

- [ ] **Step 3: Verify locally first**

Run: `cd spike/openpencil/vercel-render && npm install && npx vercel dev --listen 3111` then `curl -s localhost:3111/api/render | python3 -m json.tool`
Expected: JSON with 3 `perFrameMs` entries and plausible `jpegBytes`. Open `localhost:3111/api/render?full=1` and eyeball the image.

- [ ] **Step 4: Deploy and measure cold + warm**

```bash
npx vercel link --yes --project op-spike-render   # login interactively if prompted; creates the scratch project, NOT the prod one
npx vercel deploy --yes
curl -s https://<deployment-url>/api/render | python3 -m json.tool          # cold
sleep 2 && curl -s https://<deployment-url>/api/render | python3 -m json.tool  # warm
```

Expected + record in `NOTES.md`: cold `coldInit` + `totalMs`, warm `totalMs`, `perFrameMs`, `rssMB`. Open `/api/render?full=1` in a browser and confirm the frame renders correctly **including the text** (font correctness on the server is part of this proof).
**PASS bar (from spec §5):** all 3 frames render correctly, warm total well under the 60s cap and reasonable for a save-triggered pipeline (target: warm ≤ ~5s for 3 frames), memory under the 1769MB configured limit. Anything else = **Proof 2 FAIL** → record, stop, report (fallback per spec: different render host).

- [ ] **Step 5: Commit**

```bash
git add spike/openpencil/vercel-render
git commit -m "spike(estudio-v2): proof 2 — headless render inside deployed Vercel fn + numbers"
```

---

### Task 4: Embed + custom persistence seam (Proof 1)

**Files (in `~/Projects/open-pencil-spike` — their repo, never committed here):**
- Clone of `open-pencil/open-pencil` at tag `v0.13.2`, probe changes on a local branch `spike/embed`
- Create in sm-crm: `spike/openpencil/stub-server.mjs`, `spike/openpencil/embed.html`
- Modify: `spike/openpencil/NOTES.md`

**Interfaces:**
- Consumes: `fixtures/sample.pen`.
- Produces: `NOTES.md` list of exactly which of their files the persistence adapter + chrome-hiding touched (the "minimal-diff fork" evidence), and the load/save mechanism description the real `apps/estudio` slice will reuse.

- [ ] **Step 1: Clone, pin, run their app**

```bash
git clone https://github.com/open-pencil/open-pencil ~/Projects/open-pencil-spike
cd ~/Projects/open-pencil-spike && git checkout v0.13.2 && git switch -c spike/embed
command -v bun >/dev/null || brew install oven-sh/bun/bun
bun install && bun run dev
```

Expected: editor serves locally (note the port). Open it, confirm `fixtures/sample.pen` opens via their file-open flow.

- [ ] **Step 2: Write the persistence stub (in sm-crm)**

```js
// spike/openpencil/stub-server.mjs — plays the role of post-design-manage
import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'

let rev = 1
createServer(async (req, res) => {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-headers', 'content-type, x-expected-rev')
  if (req.method === 'OPTIONS') return res.end()
  if (req.method === 'GET' && req.url === '/doc') {
    res.setHeader('x-rev', String(rev))
    return res.end(await readFile('fixtures/sample.pen'))
  }
  if (req.method === 'PUT' && req.url === '/doc') {
    const chunks = []
    for await (const c of req) chunks.push(c)
    const body = Buffer.concat(chunks)
    if (Number(req.headers['x-expected-rev']) !== rev) { res.statusCode = 409; return res.end('conflict') }
    rev += 1
    await writeFile('fixtures/sample.pen', body)
    console.log(`saved ${body.length} bytes, rev=${rev}`)
    res.setHeader('x-rev', String(rev))
    return res.end('ok')
  }
  res.statusCode = 404; res.end()
}).listen(3112, () => console.log('stub on :3112'))
```

Run: `cd spike/openpencil && node stub-server.mjs` (must run from `spike/openpencil/` — it reads `fixtures/sample.pen` relatively)

- [ ] **Step 3: Find the IO seam in their app**

```bash
cd ~/Projects/open-pencil-spike
grep -rn "readDocument\|writeDocument\|showOpenFilePicker\|showSaveFilePicker\|OPFS\|localStorage" src/ --include="*.ts" --include="*.vue" -l | head -20
```

Identify: (a) where the app turns bytes into an open document, (b) where "save" produces bytes, (c) the app-shell entry that decides what to show on boot. Record the file list in `NOTES.md`. This step is reading, not writing.

- [ ] **Step 4: Implement the embed probe behind URL params**

On boot, when `?embed=1&docUrl=http://localhost:3112/doc` is present: fetch the URL → hand bytes to seam (a) with the rev from the `x-rev` header kept in memory; wire the app's existing save trigger (their autosave or Cmd+S path, whichever seam (b) exposes) to `PUT docUrl` with `x-expected-rev`, updating the kept rev from the response; hide the file-management chrome (start menu / open-save items / collab UI) behind the same flag — CSS-level hiding is acceptable for the probe.

There is no prescribed code here because the whole point is discovering how contained this change is. **Budget: if the probe needs to touch more than ~10 of their files or rework their state management, that is the Proof 1 FAIL condition** — stop and record rather than forcing it.

- [ ] **Step 5: Prove the loop from an iframe host page**

```html
<!-- spike/openpencil/embed.html — serve with: python3 -m http.server 3113 -->
<!doctype html><meta charset="utf-8"><title>embed probe</title>
<h3>Estúdio v2 embed probe</h3>
<iframe src="http://localhost:<their-dev-port>/?embed=1&docUrl=http://localhost:3112/doc"
        style="width:95vw;height:85vh;border:2px solid #eab308"></iframe>
```

Verify, in order: doc loads inside the iframe; edit the `ANTES`/`DEPOIS` text; save fires; stub logs `saved N bytes, rev=3`; hard-reload the host page → the edit persisted; a second stale save (replay with old rev via `curl -X PUT -H 'x-expected-rev: 1' --data-binary @fixtures/sample.pen localhost:3112/doc`) gets `409`. File chrome hidden.
Expected: all six checks pass = **Proof 1 PASS**.

- [ ] **Step 6: Record the diff footprint and commit sm-crm artifacts**

```bash
cd ~/Projects/open-pencil-spike && git diff --stat spike/embed~..spike/embed 2>/dev/null || git diff --stat
# paste the stat into NOTES.md
cd /Users/eduardosouza/Projects/sm-crm
git add spike/openpencil/stub-server.mjs spike/openpencil/embed.html spike/openpencil/NOTES.md
git commit -m "spike(estudio-v2): proof 1 — iframe embed + custom persistence via stub"
```

---

### Task 5: Findings doc + go/no-go + cleanup

**Files:**
- Create: `docs/superpowers/specs/2026-07-04-openpencil-spike-findings.md`
- Modify: `docs/superpowers/specs/2026-07-04-openpencil-estudio-inventory.md` (only if findings contradict an inventory judgment)

**Interfaces:**
- Consumes: `NOTES.md`, the three proofs' artifacts.
- Produces: the document the slice plans (fork slice, doc-service slice, MCP slice) will be written from.

- [ ] **Step 1: Write the findings doc**

Structure (fill every row from NOTES.md — no row may say "see notes"):

```markdown
# OpenPencil spike findings — 2026-MM-DD

| Proof | Result | Evidence |
|---|---|---|
| 1. Embed + persistence | PASS/FAIL | files touched: N (list); load/save/409 loop verified |
| 2. Vercel headless render | PASS/FAIL | cold init Xms / warm 3-frame total Yms / rss ZMB / fonts correct: yes-no |
| 3. Headless mutate + serialize | PASS/FAIL | round-trip + mutation-visible re-render verified |

## API facts the slice plans depend on
(load/serialize calls, frame query, text mutation, image swap, font handling, init options — exact code)

## Fork seam
(their files the adapter touched and why; chrome-hiding approach; upstream-rebase risk notes)

## Surprises / deviations from the design spec
(anything that changes spec §2–§6 assumptions, with the recommended spec amendment)

## Go/No-Go recommendation
GO / NO-GO + one paragraph.

## Cleanup ledger
- [ ] spike/openpencil/ deleted before first slice PR
- [ ] Vercel project op-spike-render deleted
- [ ] ~/Projects/open-pencil-spike kept for the fork slice (it becomes the fork's starting point) or deleted on NO-GO
```

- [ ] **Step 2: Delete the scratch Vercel deployment**

Run: `npx vercel remove op-spike-render --yes`
Expected: project gone (spike numbers live in the findings doc now).

- [ ] **Step 3: Commit and report**

```bash
git add docs/superpowers/specs/2026-07-04-openpencil-spike-findings.md
git commit -m "spike(estudio-v2): findings + go/no-go"
```

Present the findings table and the go/no-go recommendation to Eduardo. On GO → write the slice implementation plans (fork/`apps/estudio`, doc service, endpoint rework, MCP rewrite, CRM shell + cutover/deletion) as separate plan docs informed by the findings. On NO-GO → regroup per spec §8 fallbacks.
