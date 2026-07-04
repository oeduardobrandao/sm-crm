import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyFrames } from '../lib/frames.js'

const f = (over = {}) => ({ id: 'a', name: '1', x: 0, width: 1080, height: 1350, ...over })

test('publishable = preset ASPECT match; numbered frames order first, unnumbered by x', () => {
  const out = classifyFrames(
    [
      // 500×500 IS 1:1 → publishable (exported at 1080²); scratch = non-preset aspect only
      f({ id: 'b', name: 'scratch', x: 0, width: 500, height: 500 }),
      f({ id: 'c', name: '2', x: 9999 }),
      f({ id: 'a', name: '1', x: 5000 }),
    ],
    'feed',
  )
  assert.deepEqual(
    out.frames.filter((x) => x.publishable).map((x) => x.id),
    ['a', 'c', 'b'],
  )
})

test('non-preset aspect is scratch space (not publishable)', () => {
  const out = classifyFrames([f(), f({ id: 'b', name: 'note', width: 800, height: 300 })], 'feed')
  assert.deepEqual(out.frames.map((x) => x.publishable), [true, false])
})

test('aspect tolerance: 1081×1350 within 0.5% of 4:5', () => {
  const out = classifyFrames([f({ width: 1081, height: 1350 })], 'feed')
  assert.equal(out.frames[0].publishable, true)
  assert.equal(out.frames[0].aspect, '4:5')
})

test('derived tipo: 1 frame → feed, 2+ → carrossel', () => {
  assert.equal(classifyFrames([f()], 'feed').derived.tipo, 'feed')
  const two = classifyFrames([f(), f({ id: 'b', name: '2', x: 2000 })], 'feed')
  assert.equal(two.derived.tipo, 'carrossel')
  assert.equal(two.derived.format, 'carrossel')
})

test('carousel cap: 11 publishable frames → too_many_frames', () => {
  const eleven = Array.from({ length: 11 }, (_, i) => f({ id: `f${i}`, name: `${i + 1}`, x: i * 1200 }))
  const out = classifyFrames(eleven, 'carrossel')
  assert.equal(out.validation.ok, false)
  assert.equal(out.validation.errors[0].code, 'too_many_frames')
})

test('mixed aspects on a multi-frame doc → mixed_aspects', () => {
  const out = classifyFrames(
    [f(), f({ id: 'b', name: '2', x: 2000, width: 1080, height: 1080 })],
    'carrossel',
  )
  assert.equal(out.validation.ok, false)
  assert.equal(out.validation.errors[0].code, 'mixed_aspects')
})

test('no publishable frames → no_publishable_frames', () => {
  const out = classifyFrames([f({ width: 777, height: 123 })], 'feed')
  assert.equal(out.validation.ok, false)
  assert.equal(out.validation.errors[0].code, 'no_publishable_frames')
})

test('reels: first 9:16 frame is the cover; derived format reel_cover', () => {
  const out = classifyFrames(
    [f({ width: 1080, height: 1080 }), f({ id: 'cover', name: '2', x: 2000, width: 1080, height: 1920 })],
    'reels',
  )
  assert.equal(out.validation.ok, true)
  assert.equal(out.derived.format, 'reel_cover')
  assert.equal(out.derived.tipo, 'reels')
  // only the cover is publishable for a reel
  assert.deepEqual(out.frames.filter((x) => x.publishable).map((x) => x.id), ['cover'])
})

test('reels without any 9:16 frame → no_cover_frame', () => {
  const out = classifyFrames([f()], 'reels')
  assert.equal(out.validation.errors[0].code, 'no_cover_frame')
})

test('export size comes from the preset, not the on-canvas frame size', () => {
  const out = classifyFrames([f({ width: 540, height: 675 })], 'feed') // 4:5 at half size
  assert.equal(out.frames[0].aspect, '4:5')
  assert.deepEqual(out.frames[0].exportSize, { width: 1080, height: 1350 })
})
