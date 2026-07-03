// Pure file_id collection (docs/estudio-design.md §6.1 file tree). Network resolution
// (files table -> r2_key -> signed URL) lives in the hooks/ layer (useImageUrls.ts) — this module
// stays DB-free, same reasoning as designDocOps.ts.
import type { DesignDoc } from '../types';

export function collectDocFileIds(doc: DesignDoc): number[] {
  const ids = new Set<number>();
  for (const page of doc.pages) {
    if (page.background.type === 'image') ids.add(page.background.file_id);
    for (const layer of page.layers) {
      if (layer.type === 'image') ids.add(layer.file_id);
    }
  }
  return [...ids];
}
