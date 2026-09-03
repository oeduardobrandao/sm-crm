import type { KbSearchEntry } from '@/store/kb';

/** Máximo de artigos exibidos no grupo "Ajuda" do palette. */
export const KB_SEARCH_LIMIT = 5;

/** Minúsculas e sem diacríticos, para "automacao" encontrar "Automações". */
export function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
}

function haystack(a: KbSearchEntry): string {
  return normalize(`${a.title} ${a.excerpt ?? ''} ${a.tags.join(' ')}`);
}

export interface KbSearchResult {
  items: KbSearchEntry[];
  /** Total de artigos com match, antes do corte em `limit`. */
  total: number;
}

export function filterKbArticles(
  articles: KbSearchEntry[],
  query: string,
  limit: number = KB_SEARCH_LIMIT,
): KbSearchResult {
  const q = normalize(query.trim());
  if (!q) return { items: [], total: 0 };
  const matches = articles.filter((a) => haystack(a).includes(q));
  return { items: matches.slice(0, limit), total: matches.length };
}
