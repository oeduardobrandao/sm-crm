// Headless .fig → per-frame JPEGs. Lazy singleton init (a rejected module-scope promise on
// Vercel is an opaque exit-128 — spike finding), fonts registered before any export:
// Inter 400/700 from bundled assets, Noto Color Emoji pushed into the paragraph fallback
// list (setCJKFallbackFamily is additive — every paragraph gets it, Skia does per-glyph
// fallback). Unknown families still resolve via the fontManager's Google Fonts path.
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { BUILTIN_IO_FORMATS, IORegistry, initCanvasKit } from '@open-pencil/core/io'
import { computeAllLayouts } from '@open-pencil/core/layout'
import { fontManager } from '@open-pencil/core/text'

import { classifyFrames } from './frames.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const ASSET_DIRS = [join(process.cwd(), 'assets'), join(HERE, '..', 'assets')]

const toAB = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)

async function readAsset(name) {
  for (const dir of ASSET_DIRS) {
    try {
      return await readFile(join(dir, name))
    } catch {
      /* try next */
    }
  }
  throw new Error(`asset not found: ${name} (tried ${ASSET_DIRS.join(' | ')})`)
}

let ready = null
async function init() {
  await initCanvasKit()
  fontManager.markLoaded('Inter', 'Regular', toAB(await readAsset('inter-400.ttf')))
  fontManager.markLoaded('Inter', 'Bold', toAB(await readAsset('inter-700.ttf')))
  fontManager.markLoaded('Noto Color Emoji', 'Regular', toAB(await readAsset('NotoColorEmoji.ttf')))
  fontManager.setCJKFallbackFamily('Noto Color Emoji')
  return new IORegistry(BUILTIN_IO_FORMATS)
}

/**
 * @param {Uint8Array} bytes  .fig document
 * @param {'feed'|'carrossel'|'reels'} tipo
 * @returns {Promise<{validation, derived, frames, pages: Array<{frame_id, width, height, jpeg: Uint8Array}>}>}
 */
export async function renderDocument(bytes, tipo) {
  ready ??= init()
  const io = await ready

  const { graph } = await io.readDocument({ name: 'doc.fig', data: bytes })
  computeAllLayouts(graph)

  const contentPage = graph.getPages().find((p) => p.childIds.length > 0)
  const frameNodes = contentPage
    ? graph.getChildren(contentPage.id).filter((n) => n.type === 'FRAME')
    : []

  const classified = classifyFrames(
    frameNodes.map((n) => ({ id: n.id, name: n.name, x: n.x, width: n.width, height: n.height })),
    tipo,
  )

  const pages = []
  if (classified.validation.ok) {
    const byId = new Map(frameNodes.map((n) => [n.id, n]))
    for (const frame of classified.frames.filter((f) => f.publishable)) {
      const node = byId.get(frame.id)
      const scale = frame.exportSize.width / node.width
      const result = await io.exportContent(
        'jpg',
        { graph, target: { scope: 'node', nodeId: frame.id } },
        { format: 'JPG', scale, quality: 90 },
      )
      pages.push({
        frame_id: frame.id,
        width: frame.exportSize.width,
        height: frame.exportSize.height,
        jpeg: result.data,
      })
    }
  }

  return { validation: classified.validation, derived: classified.derived, frames: classified.frames, pages }
}
