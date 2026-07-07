import { test } from 'node:test'
import assert from 'node:assert/strict'

import { composeDocument } from '../lib/compose.js'
import { describeDocument, DocError } from '../lib/doc.js'
import { renderDocument } from '../lib/render.js'
import { PRESETS } from '../lib/frames.js'
import { solidPng, stubFetchFail, stubFetchOk } from './fixtures.js'

const contentPage = (proj) => proj.pages.find((p) => p.children.length > 0)

function twoFrameSpec(preset = '4:5') {
  return {
    preset,
    frames: [
      { name: '1', image: { url: 'https://x/a.png' } },
      { name: '2', image: { url: 'https://x/b.png' } },
    ],
    texts: [
      { frame: 0, text: 'Título', bbox: { x: 0.1, y: 0.1, w: 0.8, h: 0.2 }, size: 0.08, weight: 700, color: '#ffffff', align: 'CENTER' },
      { frame: 1, text: 'Legenda', bbox: { x: 0.05, y: 0.8, w: 0.9, h: 0.1 }, size: 0.04, color: '#111111' },
    ],
  }
}

test('composeDocument: frame count + preset dims in the describeDocument projection', async () => {
  const png = await solidPng(16)
  const restore = stubFetchOk(png)
  try {
    const bytes = await composeDocument(twoFrameSpec('4:5'))
    const proj = await describeDocument(bytes)
    const page = contentPage(proj)
    const frames = page.children.filter((c) => c.type === 'FRAME')
    assert.equal(frames.length, 2)
    const preset = PRESETS.find((p) => p.aspect === '4:5')
    for (const f of frames) {
      assert.equal(f.width, preset.width)
      assert.equal(f.height, preset.height)
    }
    assert.deepEqual(frames.map((f) => f.name).sort(), ['1', '2'])
  } finally {
    restore()
  }
})

test('composeDocument: image fills registered (IMAGE fill + hash present in graph.images)', async () => {
  const png = await solidPng(16)
  const restore = stubFetchOk(png)
  try {
    const bytes = await composeDocument(twoFrameSpec('1:1'))
    const proj = await describeDocument(bytes)
    const frames = contentPage(proj).children.filter((c) => c.type === 'FRAME')
    for (const f of frames) {
      assert.equal(f.fills.length, 1)
      assert.equal(f.fills[0].type, 'IMAGE')
      assert.equal(f.fills[0].scaleMode, 'FILL')
      assert.ok(f.fills[0].imageHash, 'imageHash present')
      assert.ok(proj.images.includes(f.fills[0].imageHash), 'hash present in graph.images')
    }
  } finally {
    restore()
  }
})

test('composeDocument: text nodes present with mapped bounds/style', async () => {
  const png = await solidPng(16)
  const restore = stubFetchOk(png)
  try {
    const bytes = await composeDocument(twoFrameSpec('4:5'))
    const proj = await describeDocument(bytes)
    const preset = PRESETS.find((p) => p.aspect === '4:5')
    const frames = contentPage(proj).children.filter((c) => c.type === 'FRAME')
    const frame0 = frames.find((f) => f.name === '1')
    const title = frame0.children.find((c) => c.type === 'TEXT')
    assert.equal(title.text, 'Título')
    assert.equal(title.x, 0.1 * preset.width)
    assert.equal(title.y, 0.1 * preset.height)
    assert.equal(title.width, 0.8 * preset.width)
    assert.equal(title.height, 0.2 * preset.height)
    assert.equal(title.fontSize, 0.08 * preset.height)
    assert.equal(title.fontWeight, 700)
    assert.equal(title.fontFamily, 'Inter')
    assert.equal(title.textAlignHorizontal, 'CENTER')
    assert.equal(title.fills[0].color, '#ffffff')

    const frame1 = frames.find((f) => f.name === '2')
    const caption = frame1.children.find((c) => c.type === 'TEXT')
    assert.equal(caption.text, 'Legenda')
    assert.equal(caption.fontWeight, 400) // default when unspecified
  } finally {
    restore()
  }
})

test('composeDocument: fontSize clamps to [12, 200]', async () => {
  const png = await solidPng(16)
  const restore = stubFetchOk(png)
  try {
    const spec = {
      preset: '1:1',
      frames: [{ name: '1', image: { url: 'https://x/a.png' } }],
      texts: [
        { frame: 0, text: 'tiny', bbox: { x: 0, y: 0, w: 1, h: 0.001 }, size: 0.001, color: '#000000' },
        { frame: 0, text: 'huge', bbox: { x: 0, y: 0, w: 1, h: 1 }, size: 5, color: '#000000' },
      ],
    }
    const bytes = await composeDocument(spec)
    const proj = await describeDocument(bytes)
    const texts = contentPage(proj).children[0].children
    assert.equal(texts.find((t) => t.text === 'tiny').fontSize, 12)
    assert.equal(texts.find((t) => t.text === 'huge').fontSize, 200)
  } finally {
    restore()
  }
})

test('composeDocument: round-trips through renderDocument producing N JPEGs (parity gate)', async () => {
  const png = await solidPng(16)
  const restore = stubFetchOk(png)
  try {
    const bytes = await composeDocument(twoFrameSpec('4:5'))
    const out = await renderDocument(bytes, 'carrossel')
    assert.equal(out.validation.ok, true)
    assert.equal(out.pages.length, 2)
    const preset = PRESETS.find((p) => p.aspect === '4:5')
    for (const page of out.pages) {
      assert.equal(page.width, preset.width)
      assert.equal(page.height, preset.height)
      assert.ok(page.jpeg[0] === 0xff && page.jpeg[1] === 0xd8, 'JPEG magic')
    }
  } finally {
    restore()
  }
})

test('composeDocument: fetches all frame images even when one frame has no text', async () => {
  const png = await solidPng(16)
  const restore = stubFetchOk(png)
  try {
    const spec = {
      preset: '9:16',
      frames: [{ name: '1', image: { url: 'https://x/a.png' } }],
      texts: [],
    }
    const bytes = await composeDocument(spec)
    const proj = await describeDocument(bytes)
    const frame = contentPage(proj).children[0]
    assert.equal(frame.children, undefined) // no text nodes
    assert.equal(frame.fills[0].type, 'IMAGE')
  } finally {
    restore()
  }
})

test('composeDocument: coded errors for bad specs', async () => {
  const png = await solidPng(16)
  const restoreOk = stubFetchOk(png)
  try {
    await assert.rejects(
      composeDocument({ preset: 'bogus', frames: [{ image: { url: 'https://x/a.png' } }] }),
      (err) => err instanceof DocError && err.code === 'invalid_compose_spec',
    )
    await assert.rejects(
      composeDocument({ preset: '1:1', frames: [] }),
      (err) => err instanceof DocError && err.code === 'invalid_compose_spec',
    )
    await assert.rejects(
      composeDocument({ preset: '1:1', frames: [{ image: { url: 'https://x/a.png' } }], texts: [{ frame: 5, text: 'x', bbox: { x: 0, y: 0, w: 1, h: 1 }, size: 0.1 }] }),
      (err) => err instanceof DocError && err.code === 'invalid_compose_spec',
    )
  } finally {
    restoreOk()
  }
})

test('composeDocument: image fetch failure -> image_fetch_failed', async () => {
  const restore = stubFetchFail({ status: 500 })
  try {
    await assert.rejects(
      composeDocument({ preset: '1:1', frames: [{ image: { url: 'https://x/a.png' } }] }),
      (err) => err instanceof DocError && err.code === 'image_fetch_failed',
    )
  } finally {
    restore()
  }
})
