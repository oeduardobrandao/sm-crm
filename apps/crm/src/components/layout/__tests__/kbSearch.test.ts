import { describe, expect, it } from 'vitest';
import { filterKbArticles, KB_SEARCH_LIMIT, normalize } from '../kbSearch';
import type { KbSearchEntry } from '@/store/kb';

function entry(over: Partial<KbSearchEntry> & { title: string }): KbSearchEntry {
  return {
    id: over.title,
    slug: over.title.toLowerCase().replace(/\s+/g, '-'),
    excerpt: null,
    category: 'primeiros-passos',
    tags: [],
    ...over,
  };
}

describe('normalize', () => {
  it('lowercases and strips diacritics', () => {
    expect(normalize('Automações & Relatórios')).toBe('automacoes & relatorios');
  });
});

describe('filterKbArticles', () => {
  const articles = [
    entry({ title: 'Como conectar o Instagram' }),
    entry({ title: 'Bem-vindo ao Mesaas', excerpt: 'Primeiro acesso e tour pelo painel' }),
    entry({ title: 'Cobrança e plano', tags: ['stripe', 'fatura'] }),
    entry({ title: 'Automação de comentários' }),
  ];

  it('returns nothing for an empty or whitespace query', () => {
    expect(filterKbArticles(articles, '')).toEqual({ items: [], total: 0 });
    expect(filterKbArticles(articles, '   ')).toEqual({ items: [], total: 0 });
  });

  it('matches by title', () => {
    const { items } = filterKbArticles(articles, 'instagram');
    expect(items.map((a) => a.title)).toEqual(['Como conectar o Instagram']);
  });

  it('matches by excerpt', () => {
    const { items } = filterKbArticles(articles, 'tour');
    expect(items.map((a) => a.title)).toEqual(['Bem-vindo ao Mesaas']);
  });

  it('matches by tag', () => {
    const { items } = filterKbArticles(articles, 'fatura');
    expect(items.map((a) => a.title)).toEqual(['Cobrança e plano']);
  });

  it('ignores accents in both the query and the article', () => {
    expect(filterKbArticles(articles, 'automacao').items).toHaveLength(1);
    expect(filterKbArticles(articles, 'Cobrança').items).toHaveLength(1);
    expect(filterKbArticles(articles, 'cobranca').items).toHaveLength(1);
  });

  it('caps the items at the limit but reports the full total', () => {
    const many = Array.from({ length: 7 }, (_, i) => entry({ title: `Post número ${i + 1}` }));
    const { items, total } = filterKbArticles(many, 'post');
    expect(items).toHaveLength(KB_SEARCH_LIMIT);
    expect(KB_SEARCH_LIMIT).toBe(5);
    expect(total).toBe(7);
  });
});
