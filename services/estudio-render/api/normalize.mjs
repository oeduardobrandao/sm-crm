// POST /api/normalize — {image: {url, mime}, preset} in, a single JPEG (bytes,
// exactly the preset's pixel size) out. Used ahead of /api/compose so an
// inpainted background (or any externally sourced image) always lands at
// export size before it's registered into a design.
import { DocError } from '../lib/doc.js'
import { authorized, readBody } from '../lib/http.js'
import { normalizeImage } from '../lib/normalize.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' })

  const body = await readBody(req)
  if (body === null) return res.status(413).json({ error: 'blob_too_large' })

  let spec
  try {
    spec = JSON.parse(Buffer.from(body).toString('utf8'))
  } catch {
    return res.status(422).json({ error: 'invalid_request' })
  }

  try {
    const jpeg = await normalizeImage(spec)
    res.status(200)
    res.setHeader('content-type', 'image/jpeg')
    return res.send(Buffer.from(jpeg))
  } catch (err) {
    if (err instanceof DocError) {
      return res.status(422).json({ error: err.code, message: err.message })
    }
    console.error('[normalize]', err)
    return res.status(422).json({ error: 'normalize_failed' })
  }
}
