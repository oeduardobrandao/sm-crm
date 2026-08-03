import { useCallback, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getMembros, getClientes, getTarefas } from '@/store';
import { searchPostsForMention } from '@/store/posts';
import type { MentionEntityType, MentionRef } from './types';

/** A mention search result, extending MentionRef with view-only fields (never
 * persisted -- MentionNode's attrs stay exactly {entityType, id, label, parentId}). */
export interface MentionSuggestionItem extends MentionRef {
  avatarUrl?: string;
}

export interface MentionSection {
  key: MentionEntityType;
  title: string;
  items: MentionSuggestionItem[];
}

export const MAX_RESULTS_PER_SECTION = 5;
export const MENTION_SEARCH_DEBOUNCE_MS = 200;

export const MENTION_SECTION_TITLES: Record<MentionEntityType, string> = {
  membro: 'Pessoas',
  post: 'Posts',
  cliente: 'Clientes',
  tarefa: 'Tarefas',
};

/** Accent-insensitive, case-insensitive normalization for client-side matching. */
export function normalizeForSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/** Filters items whose label contains `query` (accent/case-insensitive) and caps
 * the result. An empty query matches everything (still capped). */
export function filterAndCapMentions<T extends { label: string }>(
  items: T[],
  query: string,
  limit: number = MAX_RESULTS_PER_SECTION,
): T[] {
  const needle = normalizeForSearch(query.trim());
  const filtered =
    needle === '' ? items : items.filter((item) => normalizeForSearch(item.label).includes(needle));
  return filtered.slice(0, limit);
}

/**
 * Search data + fetcher for the @-mention dropdown (Task 4) and, later, the plain-text
 * MentionTextarea (Task 5). Both consume the same `search(query)` fetcher so results and
 * caches (membros/clientes/tarefas) stay identical across the editor and the textarea.
 *
 * Reuses the EXISTING TanStack Query keys ['membros'] / ['clientes'] / ['tarefas'] (see
 * useTarefasData.ts) so this hook shares cache with the rest of the app instead of
 * triggering a parallel fetch.
 */
export function useMentionSearch() {
  const membrosQuery = useQuery({ queryKey: ['membros'], queryFn: getMembros });
  const clientesQuery = useQuery({ queryKey: ['clientes'], queryFn: getClientes });
  const tarefasQuery = useQuery({ queryKey: ['tarefas'], queryFn: getTarefas });

  const membroRefs = useMemo<MentionSuggestionItem[]>(
    () =>
      (membrosQuery.data ?? [])
        .filter((m): m is typeof m & { id: number } => typeof m.id === 'number')
        .map((m) => ({ entityType: 'membro', id: m.id, label: m.nome, avatarUrl: m.avatar_url })),
    [membrosQuery.data],
  );

  const clienteRefs = useMemo<MentionSuggestionItem[]>(
    () =>
      (clientesQuery.data ?? [])
        .filter((c): c is typeof c & { id: number } => typeof c.id === 'number')
        .map((c) => ({ entityType: 'cliente', id: c.id, label: c.nome })),
    [clientesQuery.data],
  );

  const tarefaRefs = useMemo<MentionSuggestionItem[]>(
    () =>
      (tarefasQuery.data ?? [])
        .filter((t): t is typeof t & { id: number } => typeof t.id === 'number')
        .map((t) => ({ entityType: 'tarefa', id: t.id, label: t.titulo })),
    [tarefasQuery.data],
  );

  // Bumped at the START of every search() call (including the empty-query, no-await
  // path), so a call can tell -- at any point after an await -- whether a newer call
  // has since started. `@tiptap/suggestion` reuses a single closure-level `props`
  // object across updates and re-reads it after `items()` resolves (see
  // mentionSuggestion.ts's header comment), so it CANNOT be trusted to apply results
  // in call order itself. The ordering guard has to live here, where "newest call"
  // is unambiguous, and it has to make a superseded call a no-op -- returning ITS
  // OWN (correctly-computed-for-its-own-query-but-stale) sections would still let an
  // old query's results render over a newer query, just via a different bug.
  const debounceTokenRef = useRef(0);
  const lastResultRef = useRef<MentionSection[]>([]);

  const search = useCallback(
    async (query: string): Promise<MentionSection[]> => {
      const trimmed = query.trim();
      const token = ++debounceTokenRef.current;

      const membroSection: MentionSection = {
        key: 'membro',
        title: MENTION_SECTION_TITLES.membro,
        items: filterAndCapMentions(membroRefs, trimmed),
      };

      if (trimmed.length === 0) {
        lastResultRef.current = [membroSection];
        return lastResultRef.current;
      }

      await new Promise((resolve) => setTimeout(resolve, MENTION_SEARCH_DEBOUNCE_MS));

      let postItems: MentionSuggestionItem[] = [];
      // Skip the network call entirely if a newer search() has already started --
      // pure debounce optimization, NOT the correctness guard (see below).
      if (debounceTokenRef.current === token) {
        try {
          const rows = await searchPostsForMention(trimmed);
          postItems = rows.slice(0, MAX_RESULTS_PER_SECTION).map((r) => ({
            entityType: 'post',
            id: r.id,
            label: r.titulo,
            parentId: r.workflow_id,
          }));
        } catch (err) {
          console.error('[useMentionSearch] searchPostsForMention failed:', err);
        }
      }

      // Correctness guard: if a newer call has started (or already finished) while
      // this one was awaiting, THIS result is stale no matter how accurate it is for
      // `trimmed` -- discard it and hand back whatever the most recently applied
      // result was, so a late resolution is a render no-op for the caller.
      if (debounceTokenRef.current !== token) {
        return lastResultRef.current;
      }

      lastResultRef.current = [
        membroSection,
        { key: 'post', title: MENTION_SECTION_TITLES.post, items: postItems },
        {
          key: 'cliente',
          title: MENTION_SECTION_TITLES.cliente,
          items: filterAndCapMentions(clienteRefs, trimmed),
        },
        {
          key: 'tarefa',
          title: MENTION_SECTION_TITLES.tarefa,
          items: filterAndCapMentions(tarefaRefs, trimmed),
        },
      ];
      return lastResultRef.current;
    },
    [membroRefs, clienteRefs, tarefaRefs],
  );

  return { search };
}
