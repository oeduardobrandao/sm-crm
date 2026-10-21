import { describe, expect, it } from 'vitest';
import { filterArticles } from '../filterArticles';
import type { KbArticle } from '@/store/kb';

function article(title: string, content_plain = ''): KbArticle {
  return {
    id: title,
    title,
    slug: title,
    excerpt: null,
    content: null,
    content_plain,
    cover_image_url: null,
    category: 'relatorios',
    tags: [],
    status: 'published',
    display_order: 0,
    author_id: null,
    created_at: '',
    updated_at: '',
  };
}

describe('filterArticles', () => {
  const articles = [
    article('Como montar um relatório interativo'),
    article('Bem-vindo ao Mesaas', 'Conheça a Central de Ajuda e as automações'),
  ];

  it('returns nothing for a blank query', () => {
    expect(filterArticles(articles, '  ')).toEqual([]);
  });

  // The palette's "Ver todos em Ajuda" lands here with the raw term the user typed.
  it('matches an accented title from an unaccented query, and vice-versa', () => {
    expect(filterArticles(articles, 'relatorio').map((a) => a.title)).toEqual([
      'Como montar um relatório interativo',
    ]);
    expect(filterArticles(articles, 'Relatório')).toHaveLength(1);
  });

  it('matches inside the body ignoring accents', () => {
    expect(filterArticles(articles, 'automacoes').map((a) => a.title)).toEqual([
      'Bem-vindo ao Mesaas',
    ]);
  });
});
