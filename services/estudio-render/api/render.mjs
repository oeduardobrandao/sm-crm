// POST /api/render — .fig bytes in, frame classification + JPEGs out. Stateless compute:
// the ONLY secret here is the shared bearer; no Supabase/R2 credentials on Vercel.
// Contract consumed by supabase/functions/design-render (see the slice-3 plan header).
import { timingSafeEqual } from 'node:crypto'

import { renderDocument } from '../lib/render.js'

const MAX_BLOB_BYTES = 10 * 1024 * 1024
const TIPOS = new Set(['feed', 'carrossel', 'reels'])

function authorized(req) {
  const secret = process.env.RENDER_SERVICE_SECRET
  if (!secret) return false
  const header = req.headers.authorization ?? ''
  const expected = `Bearer ${secret}`
  const a = Buffer.from(header)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

async function readBody(req) {
  const chunks = []
  let total = 0
  for await (const chunk of req) {
    total += chunk.length
    if (total > MAX_BLOB_BYTES) return null
    chunks.push(chunk)
  }
  return new Uint8Array(Buffer.concat(chunks))
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' })

  const tipo = req.headers['x-post-tipo']
  if (!TIPOS.has(tipo)) return res.status(422).json({ error: 'invalid_tipo' })

  const bytes = await readBody(req)
  if (bytes === null) return res.status(413).json({ error: 'blob_too_large' })
  if (bytes.length === 0) return res.status(422).json({ error: 'empty_body' })

  try {
    const t0 = Date.now()
    const out = await renderDocument(bytes, tipo)
    res.status(200).json({
      validation: out.validation,
      derived: out.derived,
      frames: out.frames,
      pages: out.pages.map((p) => ({
        frame_id: p.frame_id,
        width: p.width,
        height: p.height,
        bytes: p.jpeg.length,
        jpeg_b64: Buffer.from(p.jpeg).toString('base64'),
      })),
      ms: Date.now() - t0,
    })
  } catch (err) {
    // Unparseable/corrupt .fig or render crash — generic message out, detail logged only.
    console.error('[estudio-render]', err)
    res.status(422).json({ error: 'render_failed' })
  }
}
