// Plays the role of post-design-manage for the embed probe.
// GET /doc → .fig bytes + x-rev; PUT /doc + x-expected-rev → 409 on stale rev.
import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'

let rev = 1
createServer(async (req, res) => {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-methods', 'GET, PUT, OPTIONS')
  res.setHeader('access-control-allow-headers', 'content-type, x-expected-rev, authorization')
  res.setHeader('access-control-expose-headers', 'x-rev')
  if (req.method === 'OPTIONS') return res.end()
  // auth required on the doc endpoint (contract: 401 without a valid bearer token)
  if (req.url === '/doc' && req.headers.authorization !== 'Bearer dev-token') {
    console.log(`${req.method} /doc UNAUTHORIZED (auth=${req.headers.authorization ?? 'none'})`)
    res.statusCode = 401
    return res.end('unauthorized')
  }
  if (req.method === 'GET' && req.url === '/embed-page') {
    res.setHeader('content-type', 'text/html')
    return res.end(await readFile('embed.html'))
  }
  if (req.method === 'GET' && req.url === '/doc') {
    res.setHeader('x-rev', String(rev))
    res.setHeader('content-type', 'application/octet-stream')
    console.log(`GET /doc → rev=${rev}`)
    return res.end(await readFile('fixtures/sample.fig'))
  }
  if (req.method === 'PUT' && req.url === '/doc') {
    const chunks = []
    for await (const c of req) chunks.push(c)
    const body = Buffer.concat(chunks)
    if (Number(req.headers['x-expected-rev']) !== rev) {
      console.log(`PUT /doc REJECTED (expected-rev=${req.headers['x-expected-rev']}, actual=${rev})`)
      res.statusCode = 409
      return res.end('conflict')
    }
    rev += 1
    await writeFile('fixtures/sample.fig', body)
    console.log(`PUT /doc → saved ${body.length} bytes, rev=${rev}`)
    res.setHeader('x-rev', String(rev))
    return res.end('ok')
  }
  res.statusCode = 404
  res.end()
}).listen(3112, () => console.log('stub on :3112'))
