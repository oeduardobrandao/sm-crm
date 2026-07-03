// Pure doc-mutation ops (docs/estudio-design.md §6.2). Every function here takes a `DesignDoc`
// and returns either a NEW `DesignDoc` (something changed) or the EXACT SAME reference passed
// in (the target page/layer/index didn't exist, or there was nothing to do) — never a
// structurally-equal-but-different object. That reference-identity contract is load-bearing:
// `useDesignDocState.ts` uses `nextDoc !== doc` as its sole "did this actually change" check to
// decide whether to push an undo entry, so every op here must uphold it rather than reallocating
// on a no-op path.
//
// No mutation of the input, no side effects, no ids minted outside `generateDesignId` — which is
// what makes a past/future entry safe to be just a doc value, not a diff or a mutation log.
//
// Deliberately doc-shaped, not editor-state-shaped: these ops know nothing about selection,
// active page, or undo history — `useDesignDocState.ts` owns all of that.

import { generateDesignId } from '@mesaas/design-doc';
import type { DesignDoc, NormalizedLayer, NormalizedPage } from '../types';

function withFileIds(doc: DesignDoc): DesignDoc {
  const fileIds = new Set<number>();
  for (const page of doc.pages) {
    if (page.background.type === 'image') fileIds.add(page.background.file_id);
    for (const layer of page.layers) {
      if (layer.type === 'image') fileIds.add(layer.file_id);
    }
  }
  return { ...doc, fileIds: [...fileIds] };
}

/** Replaces the page at `pageId` with `nextPage` (reference-swap only if `nextPage !== page`),
 * and refreshes `fileIds`. Returns `doc` unchanged if `pageId` doesn't exist or `updater`
 * declined to change anything (returned the same page reference). */
function updatePage(
  doc: DesignDoc,
  pageId: string,
  updater: (page: NormalizedPage) => NormalizedPage,
): DesignDoc {
  const index = doc.pages.findIndex((p) => p.id === pageId);
  if (index === -1) return doc;
  const nextPage = updater(doc.pages[index]);
  if (nextPage === doc.pages[index]) return doc;
  const pages = [...doc.pages];
  pages[index] = nextPage;
  return withFileIds({ ...doc, pages });
}

// ============================================================
// Layers
// ============================================================

/** Inserts `layer` into `pageId`'s layer stack at `index` (default: on top / end of array —
 * later entries paint over earlier ones, matching `buildPageTree`'s render order). No-op
 * (returns `doc` unchanged) if `pageId` doesn't exist. */
export function addLayer(
  doc: DesignDoc,
  pageId: string,
  layer: NormalizedLayer,
  index?: number,
): DesignDoc {
  return updatePage(doc, pageId, (page) => {
    const layers = [...page.layers];
    const at = index === undefined ? layers.length : Math.max(0, Math.min(index, layers.length));
    layers.splice(at, 0, layer);
    return { ...page, layers };
  });
}

/** Shallow-merges `patch` into the layer matching `layerId`. No-op if the page or layer doesn't
 * exist — a stale dispatch racing a concurrent removal shouldn't throw and abort an in-flight
 * gesture, and shouldn't leave a phantom undo entry either. */
export function updateLayer(
  doc: DesignDoc,
  pageId: string,
  layerId: string,
  patch: Partial<NormalizedLayer>,
): DesignDoc {
  return updatePage(doc, pageId, (page) => {
    if (!page.layers.some((l) => l.id === layerId)) return page;
    return {
      ...page,
      layers: page.layers.map((layer) =>
        layer.id === layerId ? ({ ...layer, ...patch } as NormalizedLayer) : layer,
      ),
    };
  });
}

export function removeLayer(doc: DesignDoc, pageId: string, layerId: string): DesignDoc {
  return updatePage(doc, pageId, (page) => {
    if (!page.layers.some((l) => l.id === layerId)) return page;
    return { ...page, layers: page.layers.filter((layer) => layer.id !== layerId) };
  });
}

/** Clones a layer with a fresh id, inserted directly after the original (so it's immediately
 * visible as "the copy" without hunting through the z-order). */
export function duplicateLayer(doc: DesignDoc, pageId: string, layerId: string): DesignDoc {
  return updatePage(doc, pageId, (page) => {
    const index = page.layers.findIndex((l) => l.id === layerId);
    if (index === -1) return page;
    const clone: NormalizedLayer = { ...page.layers[index], id: generateDesignId('layer') };
    const layers = [...page.layers];
    layers.splice(index + 1, 0, clone);
    return { ...page, layers };
  });
}

/** Moves a layer to `toIndex` in its page's z-order (0 = bottom/first-painted). */
export function reorderLayer(
  doc: DesignDoc,
  pageId: string,
  layerId: string,
  toIndex: number,
): DesignDoc {
  return updatePage(doc, pageId, (page) => {
    const fromIndex = page.layers.findIndex((l) => l.id === layerId);
    if (fromIndex === -1) return page;
    const clampedTo = Math.max(0, Math.min(toIndex, page.layers.length - 1));
    if (clampedTo === fromIndex) return page;
    const layers = [...page.layers];
    const [moved] = layers.splice(fromIndex, 1);
    layers.splice(clampedTo, 0, moved);
    return { ...page, layers };
  });
}

// ============================================================
// Pages
// ============================================================

// design-doc.ts Stage 1: format !== 'carrossel' locks a doc to exactly 1 page (feed/reel_cover),
// and the authoring schema caps every doc at `pages: z.array(Page).min(1).max(10)` regardless of
// format. Both invariants were previously enforced ONLY by SlideStrip's button visibility — a UI
// concern, not a data-layer one — leaving `addPage`/`duplicatePage` reachable from any future
// caller (a keyboard shortcut, a future MCP-driven op, a bug in the UI gating) with no guard
// against producing a schema-violating doc. Enforced here too, at the one place every mutation
// path funnels through, so it's impossible to bypass regardless of caller.
const MAX_PAGES = 10;

function canAddPage(doc: DesignDoc): boolean {
  return doc.format === 'carrossel' && doc.pages.length < MAX_PAGES;
}

export function addPage(doc: DesignDoc, page: NormalizedPage, index?: number): DesignDoc {
  if (!canAddPage(doc)) return doc;
  const pages = [...doc.pages];
  const at = index === undefined ? pages.length : Math.max(0, Math.min(index, pages.length));
  pages.splice(at, 0, page);
  return withFileIds({ ...doc, pages });
}

/** Deep-clones a page with a fresh page id AND fresh layer ids (so the clone never collides
 * with the original under the schema's per-doc id-uniqueness rule), inserted right after it.
 * No-op if `pageId` doesn't exist, or if `canAddPage` disallows growing the doc by one page (see
 * comment above `MAX_PAGES`). */
export function duplicatePage(doc: DesignDoc, pageId: string): DesignDoc {
  if (!canAddPage(doc)) return doc;
  const index = doc.pages.findIndex((p) => p.id === pageId);
  if (index === -1) return doc;
  const source = doc.pages[index];
  const clone: NormalizedPage = {
    ...source,
    id: generateDesignId('page'),
    layers: source.layers.map((layer) => ({ ...layer, id: generateDesignId('layer') })),
  };
  const pages = [...doc.pages];
  pages.splice(index + 1, 0, clone);
  return withFileIds({ ...doc, pages });
}

/** No-op if `pageId` doesn't exist, or if it's the document's only page — every format's
 * page-count floor is 1 (design-doc.ts Stage 1 rule 1b), so the editor UI is expected to
 * disable delete at that point; this function stays defensive rather than throwing either way. */
export function removePage(doc: DesignDoc, pageId: string): DesignDoc {
  if (doc.pages.length <= 1) return doc;
  if (!doc.pages.some((p) => p.id === pageId)) return doc;
  return withFileIds({ ...doc, pages: doc.pages.filter((p) => p.id !== pageId) });
}

export function reorderPages(doc: DesignDoc, fromIndex: number, toIndex: number): DesignDoc {
  if (fromIndex < 0 || fromIndex >= doc.pages.length) return doc;
  const clampedTo = Math.max(0, Math.min(toIndex, doc.pages.length - 1));
  if (clampedTo === fromIndex) return doc;
  const pages = [...doc.pages];
  const [moved] = pages.splice(fromIndex, 1);
  pages.splice(clampedTo, 0, moved);
  return { ...doc, pages };
}
