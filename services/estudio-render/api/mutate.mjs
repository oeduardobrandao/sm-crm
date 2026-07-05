// POST /api/mutate — MDF1-framed {json:{ops}, bytes:.fig} in, framed
// {json:{projection, applied, ms}, bytes:new .fig} out (see lib/framing.js).
// All-or-nothing: an invalid op fails the whole request with a coded 422 and
// the document is untouched. Consumed by the MCP design tools (update_design).
import { DocError, mutateDocument } from '../lib/doc.js'
import { decodeFrame, encodeFrame } from '../lib/framing.js'
import { authorized, readBody } from '../lib/http.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' })

  const body = await readBody(req)
  if (body === null) return res.status(413).json({ error: 'blob_too_large' })

  let frame
  try {
    frame = decodeFrame(body)
  } catch {
    return res.status(422).json({ error: 'bad_frame' })
  }
  if (frame.bytes.length === 0) return res.status(422).json({ error: 'empty_document' })

  try {
    const t0 = Date.now()
    const { bytes, projection, applied } = await mutateDocument(frame.bytes, frame.json?.ops)
    const out = encodeFrame({ projection, applied, ms: Date.now() - t0 }, bytes)
    res.status(200)
    res.setHeader('content-type', 'application/octet-stream')
    return res.send(Buffer.from(out))
  } catch (err) {
    if (err instanceof DocError) {
      return res.status(422).json({ error: err.code, message: err.message })
    }
    console.error('[mutate]', err)
    return res.status(422).json({ error: 'mutate_failed' })
  }
}
