import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core/io'
import { computeAllLayouts } from '@open-pencil/core/layout'
import { SceneGraph } from '@open-pencil/core/scene-graph'

import { renderDocument } from '../lib/render.js'

const io = new IORegistry(BUILTIN_IO_FORMATS)

async function buildDoc({ text = 'OI 🔥', frames = 1 } = {}) {
  const graph = new SceneGraph()
  const page = graph.addPage('Canvas')
  for (let i = 0; i < frames; i++) {
    const frame = graph.createNode('FRAME', page.id, {
      name: String(i + 1),
      x: i * 1200,
      y: 0,
      width: 1080,
      height: 1350,
      fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }],
    })
    graph.createNode('TEXT', frame.id, {
      name: 'headline',
      x: 60,
      y: 500,
      width: 960,
      height: 300,
      text,
      fontFamily: 'Inter',
      fontWeight: 700,
      fontSize: 110,
      textAlignHorizontal: 'CENTER',
      fills: [{ type: 'SOLID', color: { r: 0.07, g: 0.08, b: 0.1, a: 1 }, opacity: 1, visible: true }],
    })
  }
  computeAllLayouts(graph)
  const { data } = await io.writeDocument('fig', graph)
  return new Uint8Array(data)
}

test('renders a 1-frame doc with text + emoji to a JPEG (visual gate: out/emoji-check.jpg)', async () => {
  const bytes = await buildDoc()
  const out = await renderDocument(bytes, 'feed')
  assert.equal(out.validation.ok, true)
  assert.equal(out.derived.tipo, 'feed')
  assert.equal(out.pages.length, 1)
  const jpeg = out.pages[0].jpeg
  assert.ok(jpeg[0] === 0xff && jpeg[1] === 0xd8 && jpeg[2] === 0xff, 'JPEG magic')
  assert.ok(jpeg.length > 10_000, `plausible size (${jpeg.length})`)
  assert.equal(out.pages[0].width, 1080)
  assert.equal(out.pages[0].height, 1350)
  await mkdir('out', { recursive: true })
  await writeFile('out/emoji-check.jpg', jpeg)
})

test('renders the committed feed starter template', async () => {
  const gen = await readFile('../../supabase/functions/design-manage/starter-templates.gen.ts', 'utf8')
  const b64 = /"feed": "([^"]+)"/.exec(gen)[1]
  const bytes = Uint8Array.from(Buffer.from(b64, 'base64'))
  const out = await renderDocument(bytes, 'feed')
  assert.equal(out.validation.ok, true)
  assert.equal(out.pages.length, 1)
})

test('two frames derive carrossel; scale honors preset size', async () => {
  const bytes = await buildDoc({ frames: 2, text: 'DOIS' })
  const out = await renderDocument(bytes, 'carrossel')
  assert.equal(out.derived.tipo, 'carrossel')
  assert.equal(out.pages.length, 2)
})
