import { test } from 'node:test'
import assert from 'node:assert/strict'

import { initCanvasKit } from '@open-pencil/core/io'

import { normalizeImage } from '../lib/normalize.js'
import { DocError } from '../lib/doc.js'
import { PRESETS } from '../lib/frames.js'
import { solidPng, stubFetchFail, stubFetchOk } from './fixtures.js'

test('normalizeImage: output dims == preset (1:1) regardless of source aspect', async () => {
  const png = await solidPng(20, [0, 1, 0, 1]) // square source, non-preset absolute size
  const restore = stubFetchOk(png)
  try {
    const jpeg = await normalizeImage({ image: { url: 'https://x/img.png' }, preset: '1:1' })
    assert.ok(jpeg[0] === 0xff && jpeg[1] === 0xd8, 'JPEG magic')
    const ck = await initCanvasKit()
    const decoded = ck.MakeImageFromEncoded(jpeg)
    assert.equal(decoded.width(), 1080)
    assert.equal(decoded.height(), 1080)
    decoded.delete()
  } finally {
    restore()
  }
})

test('normalizeImage: cover-crops a wide source to 4:5 (no letterboxing)', async () => {
  const png = await solidPng(40, [0, 0, 1, 1])
  const restore = stubFetchOk(png)
  try {
    const jpeg = await normalizeImage({ image: { url: 'https://x/wide.png' }, preset: '4:5' })
    const ck = await initCanvasKit()
    const decoded = ck.MakeImageFromEncoded(jpeg)
    const preset = PRESETS.find((p) => p.aspect === '4:5')
    assert.equal(decoded.width(), preset.width)
    assert.equal(decoded.height(), preset.height)
    decoded.delete()
  } finally {
    restore()
  }
})

test('normalizeImage: rejects unknown preset with invalid_request', async () => {
  await assert.rejects(
    normalizeImage({ image: { url: 'https://x/img.png' }, preset: 'bogus' }),
    (err) => err instanceof DocError && err.code === 'invalid_request',
  )
})

test('normalizeImage: fetch failure -> image_fetch_failed', async () => {
  const restore = stubFetchFail({ status: 404 })
  try {
    await assert.rejects(
      normalizeImage({ image: { url: 'https://x/missing.png' }, preset: '1:1' }),
      (err) => err instanceof DocError && err.code === 'image_fetch_failed',
    )
  } finally {
    restore()
  }
})

test('normalizeImage: network error -> image_fetch_failed', async () => {
  const restore = stubFetchFail()
  try {
    await assert.rejects(
      normalizeImage({ image: { url: 'https://x/unreachable.png' }, preset: '1:1' }),
      (err) => err instanceof DocError && err.code === 'image_fetch_failed',
    )
  } finally {
    restore()
  }
})

test('normalizeImage: undecodable bytes -> image_decode_failed', async () => {
  const restore = stubFetchOk(new Uint8Array([1, 2, 3, 4, 5]))
  try {
    await assert.rejects(
      normalizeImage({ image: { url: 'https://x/junk.png' }, preset: '1:1' }),
      (err) => err instanceof DocError && err.code === 'image_decode_failed',
    )
  } finally {
    restore()
  }
})
