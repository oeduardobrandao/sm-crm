import { describe, expect, test } from 'vitest';
import { MessagesSquare } from 'lucide-react';
import { getNotificationDisplay } from '../notification-config';
import { NOTIFICATION_CATALOG, EMAIL_ELIGIBLE_TYPES } from '../notification-catalog';

describe('post_discussion notification', () => {
  test('single author in the general thread', () => {
    const d = getNotificationDisplay('post_discussion', {
      post_id: '9',
      workflow_id: 3,
      post_titulo: 'Reels de outubro',
      thread_field: 'geral',
      author_name: 'Carla Mendes',
      authors: ['Carla Mendes'],
      count: 1,
      preview: 'Podemos trocar a capa?',
    });
    expect(d.icon).toBe(MessagesSquare);
    expect(d.tone).toBe('teal');
    expect(d.title).toBe('Carla Mendes escreveu na discussão de Reels de outubro');
    expect(d.body).toBe('Podemos trocar a capa?');
  });

  test('grouped: two authors and three messages', () => {
    const d = getNotificationDisplay('post_discussion', {
      post_titulo: 'Reels de outubro',
      thread_field: 'geral',
      author_name: 'Carla Mendes',
      authors: ['Carla Mendes', 'Bruno'],
      count: 3,
      preview: 'Fechado',
    });
    expect(d.title).toBe(
      'Carla Mendes e mais 1 pessoa escreveram na discussão de Reels de outubro',
    );
    expect(d.body).toContain('Fechado');
    expect(d.body).toContain('3 mensagens');
  });

  test('pluralises "pessoas" for three authors', () => {
    const d = getNotificationDisplay('post_discussion', {
      post_titulo: 'P',
      thread_field: 'geral',
      author_name: 'A',
      authors: ['A', 'B', 'C'],
      count: 5,
    });
    expect(d.title).toBe('A e mais 2 pessoas escreveram na discussão de P');
  });

  test('anchored thread quotes the passage', () => {
    const d = getNotificationDisplay('post_discussion', {
      post_titulo: 'P',
      thread_field: 'legenda',
      quoted_text: 'a melhor oferta do ano',
      author_name: 'Ana',
      authors: ['Ana'],
      count: 1,
      preview: 'Sem promessa de resultado',
    });
    expect(d.title).toBe('Ana respondeu no trecho “a melhor oferta do ano”');
    expect(d.body).toBe('Sem promessa de resultado');
  });

  test('anchored thread with several authors uses the plural verb and a short quote', () => {
    const d = getNotificationDisplay('post_discussion', {
      thread_field: 'legenda',
      quoted_text: 'x'.repeat(200),
      author_name: 'Ana',
      authors: ['Ana', 'Bia'],
      count: 2,
    });
    expect(d.title).toMatch(/^Ana e mais 1 pessoa responderam no trecho “x+…”$/);
    expect(d.title.length).toBeLessThan(120);
  });

  test('a non-general field without a quote falls back to the general title', () => {
    const d = getNotificationDisplay('post_discussion', {
      post_titulo: 'P',
      thread_field: 'legenda',
      quoted_text: '',
      author_name: 'Ana',
    });
    expect(d.title).toBe('Ana escreveu na discussão de P');
  });

  test('strips raw mention tokens from the preview', () => {
    const d = getNotificationDisplay('post_discussion', {
      post_titulo: 'P',
      thread_field: 'geral',
      author_name: 'Ana',
      preview: 'oi @[Bruno](membro:6), vê isso?',
    });
    expect(d.body).toBe('oi @Bruno, vê isso?');
  });

  test('missing metadata falls back without throwing', () => {
    const d = getNotificationDisplay('post_discussion', {});
    expect(d.title).toBe('Alguém escreveu na discussão de um post');
    expect(d.body).toBe('');
    expect(() =>
      getNotificationDisplay('post_discussion', { authors: 'x', count: 'y' }),
    ).not.toThrow();
  });

  test('catalog entry: equipe category, in-app only', () => {
    expect(NOTIFICATION_CATALOG.post_discussion).toEqual({
      category: 'equipe',
      label: 'Mensagem na discussão de um post',
      when: 'alguém escreve na discussão de um post que você segue',
      recipients: 'quem escreveu, foi mencionado ou é responsável pelo post e segue a discussão',
      emailEligible: false,
    });
    expect(EMAIL_ELIGIBLE_TYPES).not.toContain('post_discussion');
  });

  test('copy has no em dash', () => {
    const d = getNotificationDisplay('post_discussion', {
      post_titulo: 'B',
      author_name: 'A',
      authors: ['A', 'C'],
      count: 4,
      preview: 'x',
    });
    const entry = NOTIFICATION_CATALOG.post_discussion;
    for (const text of [d.title, d.body, entry.label, entry.when, entry.recipients]) {
      expect(text).not.toMatch(/—/);
    }
  });
});
