import { entitlementMessage, mapEntitlementError } from '@/lib/entitlement-errors';
import type { Workflow } from '@/store';
import { converterItens, type LinhaColuna, type LinhaItem } from '@/store/linhaEditorial';
import { getPropertyDefinitions } from '@/store/posts';
import { buildPostsFromItens } from './buildPostsFromItens';

/**
 * The wizard seed's `afterCreate` (spec §7.1): turns the rows into posts of the fluxo just
 * created. Columns map to the fluxo template's properties when it has one. On failure it throws
 * an Error whose message is the toast copy; removing the empty fluxo is the wizard's job.
 */
export async function converterParaFluxo(
  linhaId: string,
  workflow: Workflow,
  itens: LinhaItem[],
  colunas: LinhaColuna[],
): Promise<{ item_id: string; post_id: number }[]> {
  try {
    const defs =
      workflow.template_id != null ? await getPropertyDefinitions(workflow.template_id) : null;
    const posts = buildPostsFromItens(itens, colunas, defs);
    return await converterItens(linhaId, workflow.id!, posts);
  } catch (err) {
    const ent = mapEntitlementError(err);
    throw new Error(
      ent
        ? entitlementMessage(ent)
        : 'Não foi possível criar os posts da linha. O fluxo não foi criado. Tente de novo.',
    );
  }
}
