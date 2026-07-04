// Proof 3b: headless frame→JPEG export with timings + mutation-visibility check.
import { readFile, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { BUILTIN_IO_FORMATS, IORegistry, initCanvasKit } from '@open-pencil/core/io'
import { computeAllLayouts } from '@open-pencil/core/layout'
import { fontManager } from '@open-pencil/core/text'

const io = new IORegistry(BUILTIN_IO_FORMATS)

console.time('canvaskit-init')
await initCanvasKit()
console.timeEnd('canvaskit-init')

// Register real fonts for the text node (headless: no browser font loading, no network).
// The render path resolves BOTH the node's style (Bold, from weight 700) and Regular fallback.
const toAB = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
fontManager.markLoaded('Inter', 'Bold', toAB(await readFile('../../public/fonts/estudio/inter/700-normal.latin.ttf')))
fontManager.markLoaded('Inter', 'Regular', toAB(await readFile('../../public/fonts/estudio/inter/400-normal.latin.ttf')))

const bytes = new Uint8Array(await readFile('fixtures/sample.fig'))
const { graph } = await io.readDocument({ name: 'sample.fig', data: bytes })
computeAllLayouts(graph)

const canvas = graph.getPages().find((p) => p.name === 'Canvas')
const frames = graph.getChildren(canvas.id).filter((n) => n.type === 'FRAME')
assert.equal(frames.length, 3)

for (const frame of frames) {
  console.time(`export ${frame.name}`)
  const result = await io.exportContent('jpg', { graph, target: { scope: 'node', nodeId: frame.id } }, { format: 'JPG', scale: 1, quality: 90 })
  console.timeEnd(`export ${frame.name}`)
  const jpeg = result.data
  assert.ok(jpeg[0] === 0xff && jpeg[1] === 0xd8 && jpeg[2] === 0xff, `${frame.name}: JPEG magic bytes`)
  assert.ok(jpeg.length > 5_000, `${frame.name}: plausible size (${jpeg.length} bytes)`)
  await writeFile(`out/${frame.name.replaceAll(' ', '_')}.jpg`, jpeg)
  console.log(`${frame.name}: ${jpeg.length} bytes`)
}

// --- mutation-visibility: change the headline, re-export, bytes must differ ---
const capa = frames.find((f) => f.name === '1 - Capa')
const first = await io.exportContent('jpg', { graph, target: { scope: 'node', nodeId: capa.id } }, { format: 'JPG', scale: 1, quality: 90 })
let textNode = graph.getChildren(capa.id).find((n) => n.type === 'TEXT')
graph.updateNode(textNode.id, { text: 'RENDER-CHECK' })
computeAllLayouts(graph)
const second = await io.exportContent('jpg', { graph, target: { scope: 'node', nodeId: capa.id } }, { format: 'JPG', scale: 1, quality: 90 })
assert.notEqual(Buffer.compare(Buffer.from(first.data), Buffer.from(second.data)), 0, 'mutated render differs')
await writeFile('out/mutated.jpg', second.data)

console.log('PASS: 3 frames exported as JPEG + mutation visible in re-render')

// --- emoji probe: what happens to emoji glyphs headless? ---
graph.updateNode(textNode.id, { text: 'OI 🔥' })
computeAllLayouts(graph)
const emoji = await io.exportContent('jpg', { graph, target: { scope: 'node', nodeId: capa.id } }, { format: 'JPG', scale: 1, quality: 90 })
await writeFile('out/emoji.jpg', emoji.data)
console.log('emoji probe written: out/emoji.jpg', emoji.data.length, 'bytes')
