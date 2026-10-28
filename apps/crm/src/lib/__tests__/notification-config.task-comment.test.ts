import { describe, expect, test } from 'vitest';
import { MessageCircle } from 'lucide-react';
import { getNotificationDisplay } from '../notification-config';
import { NOTIFICATION_CATALOG, EMAIL_ELIGIBLE_TYPES } from '../notification-catalog';

describe('task_comment notification', () => {
  test('task_comment renders title with task title', () => {
    const d = getNotificationDisplay('task_comment', {
      task_id: '42',
      task_title: 'Relatório mensal',
      author_name: 'Carla Mendes',
      authors: ['Carla Mendes'],
      count: 1,
      preview: 'Pode revisar hoje?',
    });
    expect(d.icon).toBe(MessageCircle);
    expect(d.tone).toBe('teal');
    expect(d.title).toBe('Novo comentário em Relatório mensal');
    expect(d.body).toBe('Carla Mendes: Pode revisar hoje?');
  });

  test('count 3 renders plural', () => {
    const d = getNotificationDisplay('task_comment', {
      task_title: 'Relatório mensal',
      author_name: 'Carla Mendes',
      authors: ['Carla Mendes', 'Bruno'],
      count: 3,
      preview: 'Fechado',
    });
    expect(d.title).toBe('3 novos comentários em Relatório mensal');
    // The latest author, as the RPC overwrites author_name on every upsert.
    expect(d.body).toBe('Carla Mendes: Fechado');
  });

  test('strips raw mention tokens from the preview', () => {
    const d = getNotificationDisplay('task_comment', {
      task_title: 'T',
      author_name: 'Ana',
      count: 1,
      preview: 'oi @[Bruno](membro:6), vê isso?',
    });
    expect(d.body).toBe('Ana: oi @Bruno, vê isso?');
  });

  test('body is the preview alone without an author, and the author alone without a preview', () => {
    expect(getNotificationDisplay('task_comment', { preview: 'Só o texto' }).body).toBe(
      'Só o texto',
    );
    expect(getNotificationDisplay('task_comment', { author_name: 'Ana' }).body).toBe('Ana');
  });

  test('missing metadata falls back without throwing', () => {
    const d = getNotificationDisplay('task_comment', {});
    expect(d.title).toBe('Novo comentário em uma tarefa');
    expect(d.body).toBe('');
    expect(() => getNotificationDisplay('task_comment', { count: 'y', preview: 3 })).not.toThrow();
  });

  test('task_comment catalog entry has emailEligible: false', () => {
    expect(NOTIFICATION_CATALOG.task_comment).toEqual({
      category: 'entregas_fluxo',
      label: 'Comentário em uma tarefa',
      when: 'alguém comenta em uma tarefa da qual você participa',
      recipients:
        'responsável, quem criou e quem já comentou, exceto quem escreveu e quem foi mencionado',
      emailEligible: false,
    });
    expect(EMAIL_ELIGIBLE_TYPES).not.toContain('task_comment');
  });

  test('copy has no em dash', () => {
    const d = getNotificationDisplay('task_comment', {
      task_title: 'B',
      author_name: 'A',
      count: 4,
      preview: 'x',
    });
    const entry = NOTIFICATION_CATALOG.task_comment;
    for (const text of [d.title, d.body, entry.label, entry.when, entry.recipients]) {
      expect(text).not.toMatch(/—/);
    }
  });
});
