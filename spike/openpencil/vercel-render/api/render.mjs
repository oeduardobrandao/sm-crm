// Spike proof 2: headless OpenPencil render inside a deployed Vercel Node function.
// GET /api/render        → JSON timings + sizes (or {error, stack} on failure)
// GET /api/render?full=1 → first frame as image/jpeg (visual correctness check)
import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CANDIDATE_ASSET_DIRS = [join(process.cwd(), 'assets'), join(HERE, '..', 'assets')]
const toAB = (b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)

async function findAssets() {
  for (const dir of CANDIDATE_ASSET_DIRS) {
    try { await readFile(join(dir, 'sample.fig')); return dir } catch { /* next */ }
  }
  throw new Error(`assets dir not found; tried: ${CANDIDATE_ASSET_DIRS.join(' | ')} (cwd=${process.cwd()})`)
}

let state = null
async function init() {
  const t = Date.now()
  const { BUILTIN_IO_FORMATS, IORegistry, initCanvasKit } = await import('@open-pencil/core/io')
  const { computeAllLayouts } = await import('@open-pencil/core/layout')
  const { fontManager } = await import('@open-pencil/core/text')
  await initCanvasKit()
  const assets = await findAssets()
  fontManager.markLoaded('Inter', 'Bold', toAB(await readFile(join(assets, 'inter-700.ttf'))))
  fontManager.markLoaded('Inter', 'Regular', toAB(await readFile(join(assets, 'inter-400.ttf'))))
  return { io: new IORegistry(BUILTIN_IO_FORMATS), computeAllLayouts, assets, initMs: Date.now() - t }
}

export default async function handler(req, res) {
  try {
    state ??= await init()
    const { io, computeAllLayouts, assets, initMs } = state

    const t0 = Date.now()
    const bytes = new Uint8Array(await readFile(join(assets, 'sample.fig')))
    const { graph } = await io.readDocument({ name: 'sample.fig', data: bytes })
    computeAllLayouts(graph)
    const loadMs = Date.now() - t0

    const canvas = graph.getPages().find((p) => p.name === 'Canvas')
    const frames = graph.getChildren(canvas.id).filter((n) => n.type === 'FRAME')

    const perFrameMs = []
    const jpegs = []
    for (const frame of frames) {
      const t = Date.now()
      const r = await io.exportContent('jpg', { graph, target: { scope: 'node', nodeId: frame.id } }, { format: 'JPG', scale: 1, quality: 90 })
      perFrameMs.push(Date.now() - t)
      jpegs.push(r.data)
    }

    if (req.url?.includes('full=1')) {
      res.setHeader('content-type', 'image/jpeg')
      return res.status(200).send(Buffer.from(jpegs[0]))
    }

    res.status(200).json({
      coldInit: initMs,
      loadMs,
      perFrameMs,
      totalMs: Date.now() - t0,
      jpegBytes: jpegs.map((j) => j.length),
      frames: frames.map((f) => f.name),
      rssMB: Math.round(process.memoryUsage().rss / 1e6),
      node: process.version,
    })
  } catch (err) {
    res.status(500).json({ error: String(err?.message ?? err), stack: String(err?.stack ?? '').split('\n').slice(0, 12) })
  }
}
