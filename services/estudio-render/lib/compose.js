// Builds a FRESH .fig document from an image → editable-design import: one
// FRAME per input image at the target preset's exact pixel size (background =
// the frame's own IMAGE fill, scaleMode FILL — never a read-modify-write of an
// existing doc), plus text nodes placed by caller-supplied bboxes (already in
// cropped/preset pixel space, so no transform is needed). Mirrors the graph
// construction in scripts/estudio/build-starter-figs.mjs; image bytes enter the
// graph via computeImageHash + graph.images.set, the same API the fork's own
// image-import (editor/clipboard/images.ts) uses.
import { BUILTIN_IO_FORMATS, IORegistry, initCanvasKit } from '@open-pencil/core/io'
import { computeAllLayouts } from '@open-pencil/core/layout'
import { computeImageHash } from '@open-pencil/core/figma-api'
import { SceneGraph } from '@open-pencil/core/scene-graph'

import { DocError } from './doc.js'
import { PRESETS } from './frames.js'
import { coverCropToJpeg, decodeImage, fetchImageBytes } from './normalize.js'
import { ensureExportSafeGuids } from './guids.js'

// Mirrors supabase/functions/design-manage/handler.ts MAX_BLOB_BYTES — the Node
// service cannot import Deno-side code, so the 10MB ceiling is duplicated here.
const MAX_DOC_BYTES = 10 * 1024 * 1024

const MIN_FONT_SIZE = 12
const MAX_FONT_SIZE = 200
const DEFAULT_FONT_WEIGHT = 400
const ALIGN_VALUES = new Set(['LEFT', 'CENTER', 'RIGHT', 'JUSTIFIED'])
const TRANSPARENT_COLOR = { r: 0, g: 0, b: 0, a: 0 }

const PRESET_DIMS = Object.fromEntries(PRESETS.map((p) => [p.aspect, { width: p.width, height: p.height }]))

function invalid(message) {
  return new DocError('invalid_compose_spec', message)
}

function validateSpec(spec) {
  const dims = PRESET_DIMS[spec?.preset]
  if (!dims) throw invalid(`unknown preset: ${spec?.preset}`)
  if (!Array.isArray(spec.frames) || spec.frames.length === 0) throw invalid('frames must be a non-empty array')
  spec.frames.forEach((f, i) => {
    if (!f?.image?.url) throw invalid(`frames[${i}].image.url is required`)
  })
  const texts = Array.isArray(spec.texts) ? spec.texts : []
  texts.forEach((t, i) => {
    if (typeof t.frame !== 'number' || t.frame < 0 || t.frame >= spec.frames.length) {
      throw invalid(`texts[${i}].frame out of range`)
    }
    if (typeof t.text !== 'string') throw invalid(`texts[${i}].text must be a string`)
    const b = t.bbox
    if (!b || [b.x, b.y, b.w, b.h].some((n) => typeof n !== 'number' || !Number.isFinite(n))) {
      throw invalid(`texts[${i}].bbox must have numeric x/y/w/h`)
    }
    if (typeof t.size !== 'number' || !Number.isFinite(t.size)) throw invalid(`texts[${i}].size must be a number`)
  })
  return { dims, texts }
}

/** Fetches + decodes + cover-crops one frame's image to preset dims; registers it in graph.images. */
async function prepareFrameImage(ck, graph, entry, dims) {
  const bytes = await fetchImageBytes(entry.image.url)
  const image = decodeImage(ck, bytes)
  let jpeg
  try {
    jpeg = coverCropToJpeg(ck, image, dims.width, dims.height)
  } finally {
    image.delete()
  }
  const hash = computeImageHash(jpeg)
  graph.images.set(hash, jpeg)
  return hash
}

function solidFill(hex) {
  const m = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(hex ?? '')
  if (!m) throw invalid(`invalid text color: ${hex}`)
  const n = (i) => parseInt(m[1].slice(i, i + 2), 16) / 255
  const a = m[2] ? parseInt(m[2], 16) / 255 : 1
  return { type: 'SOLID', color: { r: n(0), g: n(2), b: n(4), a }, opacity: 1, visible: true }
}

function addTextNode(graph, frameNode, dims, t) {
  const x = t.bbox.x * dims.width
  const y = t.bbox.y * dims.height
  const width = t.bbox.w * dims.width
  const height = t.bbox.h * dims.height
  const fontSize = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, t.size * dims.height))
  const align = ALIGN_VALUES.has(t.align) ? t.align : 'LEFT'

  graph.createNode('TEXT', frameNode.id, {
    name: 'Texto',
    x,
    y,
    width,
    height,
    text: t.text,
    fontFamily: 'Inter',
    fontWeight: t.weight ?? DEFAULT_FONT_WEIGHT,
    fontSize,
    textAlignHorizontal: align,
    fills: [solidFill(t.color ?? '#000000')],
  })
}

/**
 * @param {{preset: '1:1'|'4:5'|'9:16',
 *          frames: Array<{name?: string, image: {url: string, mime?: string}}>,
 *          texts?: Array<{frame: number, text: string, bbox: {x:number,y:number,w:number,h:number},
 *                         size: number, weight?: number, color?: string, align?: string}>}} spec
 * @returns {Promise<Uint8Array>} a fresh .fig document
 */
export async function composeDocument(spec) {
  const { dims, texts } = validateSpec(spec)

  const ck = await initCanvasKit()
  const graph = new SceneGraph()
  const page = graph.addPage('Canvas')

  // All frame images fetch in parallel — N frames cost one image's worth of latency.
  const hashes = await Promise.all(spec.frames.map((entry) => prepareFrameImage(ck, graph, entry, dims)))

  const frameNodes = spec.frames.map((entry, i) =>
    graph.createNode('FRAME', page.id, {
      name: entry.name ?? String(i + 1),
      x: i * (dims.width + 200),
      y: 0,
      width: dims.width,
      height: dims.height,
      clipsContent: true,
      // color is required by the fig serializer even for IMAGE fills (it falls
      // back to this when no image is loaded yet) — transparent, matching the
      // fork's own image-fill convention (editor/clipboard/images.ts).
      fills: [{ type: 'IMAGE', imageHash: hashes[i], imageScaleMode: 'FILL', color: TRANSPARENT_COLOR, opacity: 1, visible: true }],
    }),
  )

  for (const t of texts) addTextNode(graph, frameNodes[t.frame], dims, t)

  computeAllLayouts(graph)
  ensureExportSafeGuids(graph)

  const io = new IORegistry(BUILTIN_IO_FORMATS)
  const { data } = await io.writeDocument('fig', graph)
  const bytes = new Uint8Array(data)
  if (bytes.length > MAX_DOC_BYTES) throw new DocError('doc_too_large', `composed document is ${bytes.length} bytes`)
  return bytes
}
