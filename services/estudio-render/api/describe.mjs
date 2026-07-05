// POST /api/describe — .fig bytes in, scene-graph projection out. Stateless;
// same bearer as /api/render. Consumed by the MCP design tools (get_design).
import { describeDocument } from '../lib/doc.js'
import { authorized, readBody } from '../lib/http.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  if (!authorized(req)) return res.status(401).json({ error: 'unauthorized' })

  const bytes = await readBody(req)
  if (bytes === null) return res.status(413).json({ error: 'blob_too_large' })
  if (bytes.length === 0) return res.status(422).json({ error: 'empty_body' })

  try {
    const t0 = Date.now()
    const projection = await describeDocument(bytes)
    return res.status(200).json({ projection, ms: Date.now() - t0 })
  } catch (err) {
    console.error('[describe]', err)
    return res.status(422).json({ error: 'describe_failed' })
  }
}
