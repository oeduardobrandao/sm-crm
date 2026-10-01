// Seleção em massa das listas da Central de Ajuda (artigos e vídeos). O publicar/despublicar em
// massa reaproveita os handlers por item (update-kb-article, upsert-kb-video) em vez de um UPDATE
// único: cada linha passa pela própria validação do servidor -- um vídeo que ainda não está pronto
// continua recusado, e a falha de um item não derruba os outros.

export type PublishStatus = 'draft' | 'published';

export interface BulkResult {
  ok: number;
  failed: number;
}

export async function runBulk<Id>(
  ids: readonly Id[],
  fn: (id: Id) => Promise<unknown>,
): Promise<BulkResult> {
  const results = await Promise.allSettled(ids.map((id) => fn(id)));
  const ok = results.filter((r) => r.status === 'fulfilled').length;
  return { ok, failed: results.length - ok };
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Toast copy for a finished bulk run, e.g. "3 itens publicados. 1 falhou." */
export function bulkResultMessage(status: PublishStatus, { ok, failed }: BulkResult): string {
  const done =
    status === 'published'
      ? plural(ok, 'item publicado', 'itens publicados')
      : plural(ok, 'item despublicado', 'itens despublicados');
  if (failed === 0) return `${done}.`;
  const fail = plural(failed, 'falhou', 'falharam');
  return ok === 0 ? `Nenhum item alterado. ${fail}.` : `${done}. ${fail}.`;
}

/** Ids of `visible` that are in `selected`, in list order. Selection hidden by a filter never acts. */
export function visibleSelection<Id>(selected: ReadonlySet<Id>, visible: readonly Id[]): Id[] {
  return visible.filter((id) => selected.has(id));
}

/** Checked state of a group's select-all box. */
export function groupCheckState<Id>(
  selected: ReadonlySet<Id>,
  ids: readonly Id[],
): boolean | 'indeterminate' {
  const n = ids.filter((id) => selected.has(id)).length;
  if (n === 0) return false;
  return n === ids.length ? true : 'indeterminate';
}

/** Selects every id in the group, or clears them all when the group is already fully selected. */
export function toggleGroup<Id>(selected: ReadonlySet<Id>, ids: readonly Id[]): Set<Id> {
  const next = new Set(selected);
  const all = ids.length > 0 && ids.every((id) => next.has(id));
  for (const id of ids) {
    if (all) next.delete(id);
    else next.add(id);
  }
  return next;
}

export function toggleOne<Id>(selected: ReadonlySet<Id>, id: Id): Set<Id> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
