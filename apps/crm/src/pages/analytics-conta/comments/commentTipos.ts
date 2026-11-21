import type { Categoria, IgComment, StoredAnalysis } from '../../../services/instagramComments';

export const CATEGORIAS: readonly Categoria[] = ['apoio', 'duvida', 'critica', 'discussao', 'spam'];

export type TiposState = 'none' | 'legacy' | 'failed' | 'ok';

/** none: no reading; legacy: reading saved before types existed; failed/ok: tipos_status. */
export function tiposState(a: StoredAnalysis | null): TiposState {
  if (!a) return 'none';
  const status = a.result.tipos_status;
  if (status === 'failed') return 'failed';
  if (status === 'ok') return 'ok';
  return 'legacy';
}

/** Type of a comment; null for owner comments, no reading, or no type. */
export function tipoOf(c: IgComment, a: StoredAnalysis | null): Categoria | null {
  if (c.from_owner || !a) return null;
  const v = a.result.tipos?.[c.id];
  return v && CATEGORIAS.includes(v) ? v : null;
}

export function countByTipo(
  comments: IgComment[],
  a: StoredAnalysis | null,
): Record<Categoria, number> {
  const counts: Record<Categoria, number> = {
    apoio: 0,
    duvida: 0,
    critica: 0,
    discussao: 0,
    spam: 0,
  };
  for (const c of comments) {
    const t = tipoOf(c, a);
    if (t) counts[t] += 1;
  }
  return counts;
}

/** Public comments without a type: `late` arrived after the reading (outside the map),
 *  `unclassified` is everything else untyped. */
export function untypedCounts(
  comments: IgComment[],
  a: StoredAnalysis,
): { late: number; unclassified: number } {
  const tipos = a.result.tipos ?? {};
  const analyzedAt = Date.parse(a.analyzed_at);
  let late = 0;
  let unclassified = 0;
  for (const c of comments) {
    if (c.from_owner || tipos[c.id]) continue;
    const ts = Date.parse(c.timestamp);
    if (!(c.id in tipos) && Number.isFinite(ts) && Number.isFinite(analyzedAt) && ts > analyzedAt) {
      late += 1;
    } else {
      unclassified += 1;
    }
  }
  return { late, unclassified };
}
