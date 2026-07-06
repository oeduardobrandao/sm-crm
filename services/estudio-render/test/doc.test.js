import { test } from 'node:test'
import assert from 'node:assert/strict'
import { IORegistry, BUILTIN_IO_FORMATS } from '@open-pencil/core/io'
import { SceneGraph } from '@open-pencil/core/scene-graph'
import { describeDocument, mutateDocument, DocError } from '../lib/doc.js'
import { encodeFrame, decodeFrame } from '../lib/framing.js'

// A saved-then-reloaded doc (what the endpoints actually receive: bytes whose
// nodes carry stable source.id guids).
async function savedDoc() {
  const io = new IORegistry(BUILTIN_IO_FORMATS)
  const g = new SceneGraph()
  const page = g.addPage('Canvas')
  const frame = g.createNode('FRAME', page.id, {
    name: '1', x: 0, y: 0, width: 1080, height: 1350,
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }],
  })
  g.createNode('TEXT', frame.id, {
    name: 'headline', text: 'ANTES', x: 60, y: 80, width: 900, height: 140,
    fontSize: 96, fontFamily: 'Inter', fontWeight: 700,
    fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }],
  })
  const out = await io.writeDocument('fig', g)
  return new Uint8Array(out.data)
}

const contentPage = (proj) => proj.pages.find((p) => p.children.length > 0)

test('describe: projection has stable ids, text props and hex fills', async () => {
  const bytes = await savedDoc()
  const proj = await describeDocument(bytes)
  const page = contentPage(proj)
  assert.equal(page.name, 'Canvas')
  const frame = page.children[0]
  assert.equal(frame.type, 'FRAME')
  assert.match(frame.id, /^\d+:\d+$/)
  assert.equal(frame.width, 1080)
  assert.deepEqual(frame.fills, [{ type: 'SOLID', color: '#ffffff', opacity: 1 }])
  const text = frame.children[0]
  assert.equal(text.type, 'TEXT')
  assert.equal(text.text, 'ANTES')
  assert.equal(text.fontWeight, 700)
  // ids are stable: a second describe of the same bytes yields the same ids
  const proj2 = await describeDocument(bytes)
  assert.equal(contentPage(proj2).children[0].id, frame.id)
})

test('mutate: set_text + set_fill + add_text + add_frame survive the round-trip', async () => {
  const bytes = await savedDoc()
  const before = await describeDocument(bytes)
  const frame = contentPage(before).children[0]
  const text = frame.children[0]

  const { bytes: outBytes, projection, applied } = await mutateDocument(bytes, [
    { op: 'set_text', node: text.id, text: 'DEPOIS 🔥' },
    { op: 'set_fill', node: frame.id, color: '#f5ebdd' },
    { op: 'add_text', parent: frame.id, text: 'sub', x: 60, y: 260, width: 600, height: 60, fontSize: 40 },
    { op: 'add_frame', name: '2', x: 1200, y: 0, width: 1080, height: 1350 },
  ])
  assert.equal(applied, 4)

  // the RETURNED projection reflects the mutations…
  const page = contentPage(projection)
  assert.deepEqual(page.children.map((c) => c.name).sort(), ['1', '2'])

  // …and so does an independent re-read of the returned bytes.
  const proj = await describeDocument(outBytes)
  const f1 = contentPage(proj).children.find((c) => c.name === '1')
  assert.equal(f1.fills[0].color, '#f5ebdd')
  assert.deepEqual(f1.children.map((c) => c.text).sort(), ['DEPOIS 🔥', 'sub'])
  // untouched node ids stay stable across the mutation
  assert.equal(f1.id, frame.id)
  assert.equal(f1.children.find((c) => c.name === 'headline').id, text.id)
})

test('mutate: remove_node + rename + set_bounds', async () => {
  const bytes = await savedDoc()
  const before = await describeDocument(bytes)
  const frame = contentPage(before).children[0]
  const text = frame.children[0]

  const { projection } = await mutateDocument(bytes, [
    { op: 'rename', node: frame.id, name: 'capa' },
    { op: 'set_bounds', node: frame.id, x: 10, y: 20 },
    { op: 'remove_node', node: text.id },
  ])
  const f = contentPage(projection).children[0]
  assert.equal(f.name, 'capa')
  assert.equal(f.x, 10)
  assert.equal(f.children, undefined)
})

test('mutate: coded errors, document untouched on failure', async () => {
  const bytes = await savedDoc()
  const cases = [
    [[{ op: 'nope' }], 'unknown_op'],
    [[{ op: 'set_text', node: '9:99', text: 'x' }], 'node_not_found'],
    [[{ op: 'set_fill', node: (await describeDocument(bytes)).pages[1].children[0].id, color: 'red' }], 'invalid_color'],
    [[{ op: 'set_image_fill', node: '9:99', imageHash: 'abc' }], 'node_not_found'],
    [[], 'no_ops'],
  ]
  for (const [ops, code] of cases) {
    await assert.rejects(mutateDocument(bytes, ops), (err) => err instanceof DocError && err.code === code, code)
  }
  // set_text on a FRAME → wrong_node_type
  const frame = contentPage(await describeDocument(bytes)).children[0]
  await assert.rejects(
    mutateDocument(bytes, [{ op: 'set_text', node: frame.id, text: 'x' }]),
    (err) => err.code === 'wrong_node_type',
  )
})

test('framing: encode/decode round-trip and corruption handling', () => {
  const payload = new Uint8Array([1, 2, 3, 250])
  const frame = encodeFrame({ ops: [{ op: 'set_text' }] }, payload)
  const back = decodeFrame(frame)
  assert.deepEqual(back.json, { ops: [{ op: 'set_text' }] })
  assert.deepEqual([...back.bytes], [1, 2, 3, 250])

  assert.throws(() => decodeFrame(new Uint8Array([1, 2, 3])), /bad_frame/)
  assert.throws(() => decodeFrame(new TextEncoder().encode('XXXX....junk')), /bad_frame/)
  const truncated = frame.slice(0, 9)
  assert.throws(() => decodeFrame(truncated), /bad_frame/)
})
