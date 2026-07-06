// Headless .fig describe/mutate — the scene-graph projection the MCP design
// tools operate on. Node ids in the projection are `source.id` guids, which are
// STABLE across save/reload (graph-internal ids are reassigned on every read);
// ids for nodes created here are assigned by ensureExportSafeGuids before the
// write, so the projection returned by mutateDocument is always addressable.
// No CanvasKit here: mutation never rasterizes, and layout is recomputed by the
// editor on open and by /api/render at render time.
import { IORegistry, BUILTIN_IO_FORMATS } from '@open-pencil/core/io';
import { ensureExportSafeGuids } from './guids.js';

const HEX_RE = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;

export class DocError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.code = code;
  }
}

function hexToColor(hex) {
  if (typeof hex !== 'string' || !HEX_RE.test(hex)) throw new DocError('invalid_color', `invalid color: ${hex}`);
  const n = (i) => parseInt(hex.slice(i, i + 2), 16) / 255;
  return { r: n(1), g: n(3), b: n(5), a: hex.length === 9 ? n(7) : 1 };
}

function colorToHex(c) {
  if (!c) return undefined;
  const h = (v) => Math.round((v ?? 0) * 255).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}${c.a != null && c.a < 1 ? h(c.a) : ''}`;
}

function solidFill(hex) {
  return { type: 'SOLID', color: hexToColor(hex), opacity: 1, visible: true };
}

function projectFill(f) {
  if (f.type === 'SOLID') return { type: 'SOLID', color: colorToHex(f.color), opacity: f.opacity ?? 1 };
  if (f.type === 'IMAGE') return { type: 'IMAGE', imageHash: f.imageHash, scaleMode: f.imageScaleMode };
  return { type: f.type };
}

function nodeId(node) {
  return node.source?.id ?? node.id;
}

function projectNode(graph, node) {
  const out = {
    id: nodeId(node),
    type: node.type,
    name: node.name ?? '',
    x: node.x ?? 0,
    y: node.y ?? 0,
    width: node.width ?? 0,
    height: node.height ?? 0,
  };
  if (node.type === 'TEXT') {
    out.text = node.text ?? '';
    out.fontSize = node.fontSize;
    out.fontFamily = node.fontFamily;
    out.fontWeight = node.fontWeight;
    if (node.textAlignHorizontal) out.textAlignHorizontal = node.textAlignHorizontal;
  }
  if (Array.isArray(node.fills) && node.fills.length) out.fills = node.fills.map(projectFill);
  const children = graph.getChildren(node.id);
  if (children.length) out.children = children.map((c) => projectNode(graph, c));
  return out;
}

function project(graph) {
  const pages = graph
    .getPages()
    .filter((p) => !p.internalOnly)
    .map((p) => ({
      id: nodeId(p),
      name: p.name ?? '',
      children: graph.getChildren(p.id).map((c) => projectNode(graph, c)),
    }));
  return { pages, images: [...graph.images.keys()] };
}

/** source.id-first lookup (projection ids), graph-id fallback. */
function buildIndex(graph) {
  const byId = new Map();
  for (const [gid, node] of graph.nodes) {
    byId.set(gid, node);
    if (node.source?.id) byId.set(node.source.id, node);
  }
  return byId;
}

function resolve(index, id, opName) {
  const node = index.get(id);
  if (!node) throw new DocError('node_not_found', `${opName}: node ${id} not found`);
  return node;
}

function assertType(node, type, opName) {
  if (node.type !== type) {
    throw new DocError('wrong_node_type', `${opName}: node ${nodeId(node)} is ${node.type}, expected ${type}`);
  }
}

function pickBounds(op) {
  const patch = {};
  for (const k of ['x', 'y', 'width', 'height']) {
    if (op[k] != null) {
      if (typeof op[k] !== 'number' || !Number.isFinite(op[k])) throw new DocError('invalid_value', `invalid ${k}`);
      patch[k] = op[k];
    }
  }
  return patch;
}

function contentPage(graph) {
  const pages = graph.getPages().filter((p) => !p.internalOnly);
  return pages.find((p) => p.childIds.length > 0) ?? pages[0];
}

const OPS = {
  set_text(graph, index, op) {
    const node = resolve(index, op.node, 'set_text');
    assertType(node, 'TEXT', 'set_text');
    if (typeof op.text !== 'string') throw new DocError('invalid_value', 'set_text: text must be a string');
    graph.updateNode(node.id, { text: op.text });
  },
  set_text_style(graph, index, op) {
    const node = resolve(index, op.node, 'set_text_style');
    assertType(node, 'TEXT', 'set_text_style');
    const patch = {};
    if (op.fontSize != null) patch.fontSize = op.fontSize;
    if (op.fontFamily != null) patch.fontFamily = op.fontFamily;
    if (op.fontWeight != null) patch.fontWeight = op.fontWeight;
    if (op.textAlignHorizontal != null) patch.textAlignHorizontal = op.textAlignHorizontal;
    if (op.color != null) patch.fills = [solidFill(op.color)];
    graph.updateNode(node.id, patch);
  },
  set_fill(graph, index, op) {
    const node = resolve(index, op.node, 'set_fill');
    graph.updateNode(node.id, { fills: [solidFill(op.color)] });
  },
  set_image_fill(graph, index, op) {
    const node = resolve(index, op.node, 'set_image_fill');
    if (!graph.images.has(op.imageHash)) {
      throw new DocError('image_not_found', `set_image_fill: image ${op.imageHash} not in document`);
    }
    graph.updateNode(node.id, {
      fills: [{ type: 'IMAGE', imageHash: op.imageHash, imageScaleMode: op.scaleMode ?? 'FILL', opacity: 1, visible: true }],
    });
  },
  set_bounds(graph, index, op) {
    const node = resolve(index, op.node, 'set_bounds');
    graph.updateNode(node.id, pickBounds(op));
  },
  rename(graph, index, op) {
    const node = resolve(index, op.node, 'rename');
    if (typeof op.name !== 'string' || !op.name) throw new DocError('invalid_value', 'rename: name required');
    graph.updateNode(node.id, { name: op.name });
  },
  remove_node(graph, index, op) {
    const node = resolve(index, op.node, 'remove_node');
    graph.deleteNode(node.id);
  },
  add_text(graph, index, op) {
    const parent = resolve(index, op.parent, 'add_text');
    if (typeof op.text !== 'string') throw new DocError('invalid_value', 'add_text: text must be a string');
    graph.createNode('TEXT', parent.id, {
      name: op.name ?? 'Texto',
      text: op.text,
      ...pickBounds(op),
      fontSize: op.fontSize ?? 48,
      fontFamily: op.fontFamily ?? 'Inter',
      fontWeight: op.fontWeight ?? 400,
      ...(op.textAlignHorizontal ? { textAlignHorizontal: op.textAlignHorizontal } : {}),
      fills: [solidFill(op.color ?? '#111111')],
    });
  },
  add_frame(graph, index, op) {
    const page = op.page ? resolve(index, op.page, 'add_frame') : contentPage(graph);
    if (page.type !== 'CANVAS') throw new DocError('wrong_node_type', 'add_frame: page must be a page');
    graph.createNode('FRAME', page.id, {
      name: op.name ?? String(graph.getChildren(page.id).length + 1),
      ...pickBounds(op),
      // Post pages clip: the export crops to frame bounds, the canvas must agree.
      clipsContent: true,
      fills: [solidFill(op.color ?? '#ffffff')],
    });
  },
};

async function read(bytes) {
  const io = new IORegistry(BUILTIN_IO_FORMATS);
  const { graph } = await io.readDocument({ name: 'doc.fig', data: bytes });
  return { io, graph };
}

export async function describeDocument(bytes) {
  const { graph } = await read(bytes);
  return project(graph);
}

/**
 * Applies ops in order (all-or-nothing: any invalid op throws before the write)
 * and returns { bytes, projection, applied }. The projection comes from
 * RE-READING the written bytes, so its node ids are the persisted stable ids.
 */
export async function mutateDocument(bytes, ops) {
  if (!Array.isArray(ops) || ops.length === 0) throw new DocError('no_ops', 'ops must be a non-empty array');
  const { io, graph } = await read(bytes);
  const index = buildIndex(graph);
  for (const op of ops) {
    const impl = OPS[op?.op];
    if (!impl) throw new DocError('unknown_op', `unknown op: ${op?.op}`);
    impl(graph, index, op);
  }
  ensureExportSafeGuids(graph);
  const out = await io.writeDocument('fig', graph);
  const written = new Uint8Array(out.data);
  const projection = await describeDocument(written);
  return { bytes: written, projection, applied: ops.length };
}

export const SUPPORTED_OPS = Object.keys(OPS);
