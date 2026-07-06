// POST /api/compose — {preset, frames, texts} in, a fresh .fig document (raw
// bytes) out. Turns an image (or a set of per-frame images) into an editable
// design: one FRAME per entry with the image as its background fill, plus
// caller-placed text nodes. Never reads an existing document.
import { DocError } from '../lib/doc.js'
import { composeDocument } from '../lib/compose.js'
import { authorized, readBody } from '../lib/http.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' })

  const body = await readBody(req)
  if (body === null) return res.status(413).json({ error: 'blob_too_large' })

  let spec
  try {
    spec = JSON.parse(Buffer.from(body).toString('utf8'))
  } catch {
    return res.status(422).json({ error: 'invalid_compose_spec' })
  }

  try {
    const bytes = await composeDocument(spec)
    res.status(200)
    res.setHeader('content-type', 'application/octet-stream')
    return res.send(Buffer.from(bytes))
  } catch (err) {
    if (err instanceof DocError) {
      return res.status(422).json({ error: err.code, message: err.message })
    }
    console.error('[compose]', err)
    return res.status(422).json({ error: 'compose_failed' })
  }
}
