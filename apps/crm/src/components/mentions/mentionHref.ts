import type { MentionRef } from './types';

/**
 * Resolves a mention reference to its CRM deep link, per the live routes in the
 * at-mentions spec's Global Constraints. A post mention always resolves: its
 * `id` is the post's own id, so a post avulso (no `parentId`/workflow) still
 * links via the universal `?post=` form -- the same postHref pattern used by
 * every other post link producer (GlobalSearchTrigger, PostChip, todayAgenda).
 * Only an unknown entity type falls through to `null`, which callers render
 * unlinked.
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
      return ref.parentId != null
        ? `/entregas?drawer=${ref.parentId}&post=${ref.id}`
        : `/entregas?post=${ref.id}`;
    default:
      return null;
  }
}
