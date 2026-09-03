import { normalize } from '@/components/layout/kbSearch';
import type { KbArticle } from '@/store/kb';

/**
 * Busca da Central de Ajuda: título ou corpo, sem diferenciar acentos, para
 * bater com o que o palette (⌘K) já faz e o link "Ver todos em Ajuda"
 * (`/ajuda?q=relatorio`) não cair em "Nenhum artigo encontrado".
 */
export function filterArticles(articles: KbArticle[], search: string): KbArticle[] {
  const q = normalize(search.trim());
  if (!q) return [];
  return articles.filter(
    (a) => normalize(a.title).includes(q) || normalize(a.content_plain).includes(q),
  );
}
