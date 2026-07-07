// Fetch an arbitrary image, cover-crop/scale it to an exact Instagram preset
// pixel size, and re-encode as JPEG. Used ahead of compose so an inpainted
// background (or any uploaded image) always lands at the frame's export size —
// compose's own re-encode of the background is then a no-op crop.
import { initCanvasKit } from '@open-pencil/core/io'

import { DocError } from './doc.js'
import { PRESETS } from './frames.js'

const FETCH_TIMEOUT_MS = 20_000
const JPEG_QUALITY = 90

const PRESET_DIMS = Object.fromEntries(PRESETS.map((p) => [p.aspect, { width: p.width, height: p.height }]))

export async function fetchImageBytes(url) {
  let res
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  } catch (err) {
    throw new DocError('image_fetch_failed', `fetch failed for ${url}: ${err.message}`)
  }
  if (!res.ok) throw new DocError('image_fetch_failed', `fetch ${url} returned ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}

/**
 * Draws `image` (already-decoded CanvasKit image) into a `width`×`height` surface using a
 * cover crop (scale to fill, center-crop the overflow — never letterboxes) and returns the
 * encoded JPEG bytes. Caller owns `image`'s lifetime.
 */
export function coverCropToJpeg(ck, image, width, height) {
  const srcW = image.width()
  const srcH = image.height()
  const scale = Math.max(width / srcW, height / srcH)
  const drawW = srcW * scale
  const drawH = srcH * scale
  const dx = (width - drawW) / 2
  const dy = (height - drawH) / 2

  const pixels = ck.Malloc(Uint8Array, width * height * 4)
  const surface = ck.MakeRasterDirectSurface(
    { alphaType: ck.AlphaType.Premul, colorType: ck.ColorType.RGBA_8888, colorSpace: ck.ColorSpace.SRGB, width, height },
    pixels,
    width * 4,
  )
  if (!surface) {
    ck.Free(pixels)
    throw new DocError('image_decode_failed', 'failed to allocate raster surface')
  }
  try {
    const canvas = surface.getCanvas()
    canvas.clear(ck.WHITE)
    canvas.drawImageRectOptions(
      image,
      ck.LTRBRect(0, 0, srcW, srcH),
      ck.LTRBRect(dx, dy, dx + drawW, dy + drawH),
      ck.FilterMode.Linear,
      ck.MipmapMode.None,
      null,
    )
    surface.flush()
    const snapshot = surface.makeImageSnapshot()
    try {
      const encoded = snapshot.encodeToBytes(ck.ImageFormat.JPEG, JPEG_QUALITY)
      if (!encoded) throw new DocError('image_decode_failed', 'JPEG encode failed')
      return new Uint8Array(encoded)
    } finally {
      snapshot.delete()
    }
  } finally {
    surface.delete()
    ck.Free(pixels)
  }
}

export function decodeImage(ck, bytes) {
  const image = ck.MakeImageFromEncoded(bytes)
  if (!image) throw new DocError('image_decode_failed', 'CanvasKit could not decode the image bytes')
  return image
}

/**
 * @param {{image: {url: string, mime?: string}, preset: '1:1'|'4:5'|'9:16'}} spec
 * @returns {Promise<Uint8Array>} JPEG bytes at the preset's exact pixel size
 */
export async function normalizeImage(spec) {
  const dims = PRESET_DIMS[spec?.preset]
  if (!dims) throw new DocError('invalid_request', `unknown preset: ${spec?.preset}`)
  if (!spec?.image?.url) throw new DocError('invalid_request', 'image.url is required')

  const bytes = await fetchImageBytes(spec.image.url)
  const ck = await initCanvasKit()
  const image = decodeImage(ck, bytes)
  try {
    return coverCropToJpeg(ck, image, dims.width, dims.height)
  } finally {
    image.delete()
  }
}
