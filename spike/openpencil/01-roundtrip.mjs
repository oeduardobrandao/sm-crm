// Proof 3a: create → serialize → reload → mutate → serialize → reload, all in plain Node.
// Builds the fixture programmatically (fixtures/sample.fig) that every later probe consumes.
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core/io'
import { computeAllLayouts } from '@open-pencil/core/layout'
import { SceneGraph } from '@open-pencil/core/scene-graph'

const io = new IORegistry(BUILTIN_IO_FORMATS)

// 1x1 red PNG (valid, decodable) for the image-fill probe
const RED_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)
// 1x1 blue PNG for the swap probe
const BLUE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPj/HwADAgH/p+FBjAAAAABJRU5ErkJggg==',
  'base64'
)

console.time('build graph')
const graph = new SceneGraph()
const page = graph.addPage('Canvas')

const frameNames = ['1 - Capa', '2 - Meio', '3 - CTA']
const frames = frameNames.map((name, i) =>
  graph.createNode('FRAME', page.id, {
    name,
    x: i * 1200,
    y: 0,
    width: 1080,
    height: 1080,
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }],
  })
)

const textNode = graph.createNode('TEXT', frames[0].id, {
  name: 'headline',
  x: 100,
  y: 420,
  width: 880,
  height: 240,
  text: 'ANTES',
  fontFamily: 'Inter',
  fontWeight: 700,
  fontSize: 120,
  textAlignHorizontal: 'CENTER',
  fills: [{ type: 'SOLID', color: { r: 0.07, g: 0.08, b: 0.1, a: 1 }, opacity: 1, visible: true }],
})

// .fig writer requires imageHash to be a hex digest (Figma-style sha1 of the bytes)
const sha1 = (buf) => createHash('sha1').update(buf).digest('hex')
const RED_HASH = sha1(RED_PNG)
const BLUE_HASH = sha1(BLUE_PNG)

graph.images.set(RED_HASH, new Uint8Array(RED_PNG))
const imageRect = graph.createNode('RECTANGLE', frames[0].id, {
  name: 'photo',
  x: 100,
  y: 100,
  width: 880,
  height: 280,
  fills: [{ type: 'IMAGE', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true, imageHash: RED_HASH, imageScaleMode: 'FILL' }],
})
computeAllLayouts(graph)
console.timeEnd('build graph')

// --- serialize → fixture ---
console.time('write pen')
const out1 = await io.writeDocument('fig', graph)
console.timeEnd('write pen')
assert.ok(out1?.data?.length > 0, 'writeDocument produced bytes')
await writeFile('fixtures/sample.fig', out1.data)
console.log(`fixture written: ${out1.data.length} bytes (.${out1.extension})`)

// --- reload → verify structure survived ---
console.time('reload')
const { graph: g2 } = await io.readDocument({ name: 'sample.fig', data: new Uint8Array(await readFile('fixtures/sample.fig')) })
computeAllLayouts(g2)
console.timeEnd('reload')

// NOTE: the .fig writer injects a default empty "Page 1"; our content page is found by name
const pages2 = g2.getPages()
assert.ok(pages2.length >= 1, 'page survived')
const canvas2 = pages2.find((p) => p.name === 'Canvas')
assert.ok(canvas2, 'our page survived (by name)')
const frames2 = g2.getChildren(canvas2.id).filter((n) => n.type === 'FRAME')
assert.equal(frames2.length, 3, 'expected 3 frames after reload')
assert.deepEqual(frames2.map((f) => f.name).sort(), ['1 - Capa', '2 - Meio', '3 - CTA'])
const capa2 = frames2.find((f) => f.name === '1 - Capa')
const text2 = g2.getChildren(capa2.id).find((n) => n.type === 'TEXT')
assert.ok(text2, 'text node survived')
assert.equal(text2.text, 'ANTES')
assert.equal(text2.fontWeight, 700)
const rect2 = g2.getChildren(capa2.id).find((n) => n.type === 'RECTANGLE')
assert.equal(rect2.fills[0].type, 'IMAGE', 'image fill survived')
assert.ok(g2.images.get(rect2.fills[0].imageHash)?.length === RED_PNG.length, 'image bytes survived in graph.images')

// --- mutate: set text + swap image (new bytes under their own hash, fill re-pointed) ---
g2.updateNode(text2.id, { text: 'DEPOIS' })
g2.images.set(BLUE_HASH, new Uint8Array(BLUE_PNG))
g2.updateNode(rect2.id, { fills: [{ ...rect2.fills[0], imageHash: BLUE_HASH }] })
computeAllLayouts(g2)

// --- serialize → reload → verify mutation persisted ---
const out2 = await io.writeDocument('fig', g2)
await writeFile('out/roundtrip.fig', out2.data)
const { graph: g3 } = await io.readDocument({ name: 'roundtrip.fig', data: new Uint8Array(await readFile('out/roundtrip.fig')) })
const canvas3 = g3.getPages().find((p) => p.name === 'Canvas')
const capa3 = g3.getChildren(canvas3.id).find((n) => n.name === '1 - Capa')
const text3 = g3.getChildren(capa3.id).find((n) => n.type === 'TEXT')
assert.equal(text3.text, 'DEPOIS', 'text mutation survived serialize/reload')
const rect3 = g3.getChildren(capa3.id).find((n) => n.type === 'RECTANGLE')
assert.equal(rect3.fills[0].imageHash, BLUE_HASH, 'fill points at the swapped image')
assert.equal(g3.images.get(BLUE_HASH)?.length, BLUE_PNG.length, 'image swap survived serialize/reload')

console.log('PASS: headless load/mutate/serialize round-trip')
