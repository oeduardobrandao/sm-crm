import { describe, expect, test } from 'vitest';
import { PackageCheck } from 'lucide-react';
import { getNotificationDisplay } from '../notification-config';
import { NOTIFICATION_CATALOG, EMAIL_ELIGIBLE_TYPES } from '../notification-catalog';

describe('post_material_complete notification', () => {
  test('auto close: everything was sent', () => {
    const d = getNotificationDisplay('post_material_complete', {
      client_name: 'Clínica X',
      post_title: 'Post 1',
      closed_by: 'auto',
      done: 3,
      total: 3,
      workflow_id: 3,
      post_id: 9,
    });
    expect(d.icon).toBe(PackageCheck);
    expect(d.tone).toBe('success');
    expect(d.title).toBe('Clínica X enviou todos os itens pedidos em Post 1');
    expect(d.body).toBe('');
  });

  test('client close: sent what they had', () => {
    const d = getNotificationDisplay('post_material_complete', {
      client_name: 'Clínica X',
      post_title: 'Post 1',
      closed_by: 'client',
      done: 2,
      total: 3,
    });
    expect(d.title).toBe('Clínica X enviou o que tinha (2 de 3 itens) em Post 1');
  });

  test('falls back when the metadata is missing', () => {
    const d = getNotificationDisplay('post_material_complete', {});
    expect(d.title).toBe('Cliente enviou todos os itens pedidos em Post');
  });

  test('appears in the in-app preferences, never by e-mail', () => {
    const entry = NOTIFICATION_CATALOG.post_material_complete;
    expect(entry.category).toBe('aprovacoes_hub');
    expect(entry.label).toBe('Material do cliente');
    expect(entry.emailEligible).toBe(false);
    expect(EMAIL_ELIGIBLE_TYPES).not.toContain('post_material_complete');
  });

  test('new copy has no em dash', () => {
    const entry = NOTIFICATION_CATALOG.post_material_complete;
    for (const closed_by of ['auto', 'client']) {
      const d = getNotificationDisplay('post_material_complete', {
        client_name: 'A',
        post_title: 'B',
        closed_by,
        done: 1,
        total: 2,
      });
      for (const text of [d.title, d.body]) expect(text).not.toMatch(/—/);
    }
    for (const text of [entry.label, entry.when, entry.recipients]) expect(text).not.toMatch(/—/);
  });
});
