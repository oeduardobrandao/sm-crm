// Test-only fixture generator: a tiny solid-color PNG, encoded with CanvasKit
// itself so no binary fixture file needs to be committed.
import { initCanvasKit } from '@open-pencil/core/io'

/** @returns {Promise<Uint8Array>} PNG bytes for a `size`×`size` solid-color square. */
export async function solidPng(size = 8, rgba = [1, 0, 0, 1]) {
  const ck = await initCanvasKit()
  const pixels = ck.Malloc(Uint8Array, size * size * 4)
  const surface = ck.MakeRasterDirectSurface(
    { alphaType: ck.AlphaType.Premul, colorType: ck.ColorType.RGBA_8888, colorSpace: ck.ColorSpace.SRGB, width: size, height: size },
    pixels,
    size * 4,
  )
  try {
    const canvas = surface.getCanvas()
    canvas.clear(ck.Color4f(...rgba))
    surface.flush()
    const snapshot = surface.makeImageSnapshot()
    try {
      const encoded = snapshot.encodeToBytes(ck.ImageFormat.PNG, 100)
      return new Uint8Array(encoded)
    } finally {
      snapshot.delete()
    }
  } finally {
    surface.delete()
    ck.Free(pixels)
  }
}

/** Stubs global.fetch to serve `bytes` for any URL; returns a restore() fn. */
export function stubFetchOk(bytes, { contentType = 'image/png' } = {}) {
  const original = globalThis.fetch
  globalThis.fetch = async () => new Response(bytes, { status: 200, headers: { 'content-type': contentType } })
  return () => {
    globalThis.fetch = original
  }
}

/** Stubs global.fetch to fail (network error or a non-2xx status). */
export function stubFetchFail({ status = null } = {}) {
  const original = globalThis.fetch
  globalThis.fetch = async () => {
    if (status === null) throw new Error('simulated network failure')
    return new Response('nope', { status })
  }
  return () => {
    globalThis.fetch = original
  }
}
