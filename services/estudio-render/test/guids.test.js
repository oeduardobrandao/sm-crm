import { test } from 'node:test'
import assert from 'node:assert/strict'
import { IORegistry, BUILTIN_IO_FORMATS } from '@open-pencil/core/io'
import { SceneGraph } from '@open-pencil/core/scene-graph'
import { ensureExportSafeGuids } from '../lib/guids.js'

// End-to-end proof of the write-after-read fix: without ensureExportSafeGuids,
// a node created on an imported graph steals an imported session-1 guid and the
// re-import DROPS the node that owned it (the slice-3 "frame loss" gotcha).

async function twoGenerationDoc() {
  const io = new IORegistry(BUILTIN_IO_FORMATS)
  // gen 0: fresh graph — its frame gets a session-1 guid on export
  const g0 = new SceneGraph()
  const page = g0.addPage('Canvas')
  g0.createNode('FRAME', page.id, { name: 'keeper', x: 0, y: 0, width: 1080, height: 1350 })
  const gen1 = await io.writeDocument('fig', g0)
  // gen 1: import it back (what the mutate endpoint receives)
  const { graph } = await io.readDocument({ name: 'doc.fig', data: new Uint8Array(gen1.data) })
  return { io, graph }
}

function contentChildren(graph) {
  const page = graph.getPages().find((p) => p.childIds.length > 0)
  return page ? graph.getChildren(page.id) : []
}

test('BUG BASELINE: created node on imported graph kills an imported node', async () => {
  const { io, graph } = await twoGenerationDoc()
  const keeper = contentChildren(graph).find((n) => n.name === 'keeper')
  graph.createNode('TEXT', keeper.id, {
    name: 'added', text: 'hi', x: 0, y: 0, width: 100, height: 40,
    fontSize: 24, fontFamily: 'Inter', fontWeight: 400,
  })
  const out = await io.writeDocument('fig', graph)
  const { graph: g2 } = await io.readDocument({ name: 'out.fig', data: new Uint8Array(out.data) })
  const names = contentChildren(g2).map((n) => n.name)
  // Documents the upstream bug this module works around. If @open-pencil/core is
  // bumped to a version where this ASSERTION FAILS (keeper survives), the
  // workaround can be retired — see lib/guids.js.
  assert.equal(names.includes('keeper'), false)
})

test('ensureExportSafeGuids keeps every node through mutate → write → read', async () => {
  const { io, graph } = await twoGenerationDoc()
  const keeper = contentChildren(graph).find((n) => n.name === 'keeper')
  graph.createNode('TEXT', keeper.id, {
    name: 'added', text: 'hi', x: 0, y: 0, width: 100, height: 40,
    fontSize: 24, fontFamily: 'Inter', fontWeight: 400,
  })
  graph.createNode('FRAME', graph.getPages().find((p) => p.childIds.length > 0).id, {
    name: '2', x: 1200, y: 0, width: 1080, height: 1350,
  })

  const assigned = ensureExportSafeGuids(graph)
  assert.equal(assigned, 2)

  const out = await io.writeDocument('fig', graph)
  const { graph: g2 } = await io.readDocument({ name: 'out.fig', data: new Uint8Array(out.data) })
  const kids = contentChildren(g2)
  assert.deepEqual(kids.map((n) => n.name).sort(), ['2', 'keeper'])
  const keeper2 = kids.find((n) => n.name === 'keeper')
  assert.deepEqual(g2.getChildren(keeper2.id).map((n) => n.name), ['added'])
})

test('idempotent: second call assigns nothing; untouched graphs assign nothing', async () => {
  const { graph } = await twoGenerationDoc()
  assert.equal(ensureExportSafeGuids(graph), 0) // pure read: all nodes have source ids
  const keeper = contentChildren(graph).find((n) => n.name === 'keeper')
  graph.createNode('TEXT', keeper.id, {
    name: 't', text: 'x', x: 0, y: 0, width: 10, height: 10,
    fontSize: 10, fontFamily: 'Inter', fontWeight: 400,
  })
  assert.equal(ensureExportSafeGuids(graph), 1)
  assert.equal(ensureExportSafeGuids(graph), 0)
})
