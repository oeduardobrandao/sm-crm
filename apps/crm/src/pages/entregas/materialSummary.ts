import { getMaterialSummary, type MaterialSummaryRow } from '@/store/postReferences';

/** Post statuses on which a concluded material request still reads as "recebido". */
export const INTERNAL_POST_STATUSES: readonly string[] = [
  'rascunho',
  'revisao_interna',
  'aprovado_interno',
];

export type MaterialKind = 'aguardando' | 'recebido';
export const MATERIAL_KINDS: readonly MaterialKind[] = ['aguardando', 'recebido'];

/** The server caps one summary call at 200 ids. */
export const MATERIAL_SUMMARY_CHUNK = 200;

export interface MaterialBadgeData {
  kind: MaterialKind;
  done: number;
  total: number;
}

/**
 * What a post card shows: waiting while the request is open; received only while the
 * post is still internal; nothing for a cancelled request or a concluded one on a post
 * that already left the house.
 */
export function materialBadge(
  row: MaterialSummaryRow | undefined,
  postStatus: string,
): MaterialBadgeData | null {
  if (!row) return null;
  if (row.status === 'aberto') return { kind: 'aguardando', done: row.done, total: row.total };
  if (row.status === 'concluido' && INTERNAL_POST_STATUSES.includes(postStatus))
    return { kind: 'recebido', done: row.done, total: row.total };
  return null;
}

/** The filter reads the badge, so a card and its filter can never disagree. */
export function matchesMaterialFilter(
  row: MaterialSummaryRow | undefined,
  postStatus: string,
  selected: readonly MaterialKind[],
): boolean {
  if (selected.length === 0) return true;
  const badge = materialBadge(row, postStatus);
  return badge != null && selected.includes(badge.kind);
}

/** One request per chunk of 200 ids, never per card. */
export async function fetchMaterialSummaryMap(
  postIds: number[],
): Promise<Map<number, MaterialSummaryRow>> {
  const map = new Map<number, MaterialSummaryRow>();
  for (let i = 0; i < postIds.length; i += MATERIAL_SUMMARY_CHUNK) {
    const rows = await getMaterialSummary(postIds.slice(i, i + MATERIAL_SUMMARY_CHUNK));
    for (const r of rows) map.set(r.post_id, r);
  }
  return map;
}
