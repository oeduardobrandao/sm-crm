import type { MentionRef } from './types';

/**
 * Resolves a mention reference to its CRM deep link, per the live routes in the
 * at-mentions spec's Global Constraints. Returns `null` when there is nowhere to
 * link (a post mention without a `parentId`/workflow id) -- callers should render
 * the chip unlinked in that case.
 */
export function mentionHref(ref: MentionRef): string | null {
  switch (ref.entityType) {
    case 'membro':
      return `/equipe/${ref.id}`;
    case 'cliente':
      return `/clientes/${ref.id}`;
    case 'tarefa':
      return `/tarefas?tarefa=${ref.id}`;
    case 'post':
      return ref.parentId ? `/entregas?drawer=${ref.parentId}` : null;
    default:
      return null;
  }
}
