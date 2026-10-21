import { describe, expect, test } from 'vitest';
import { Paperclip } from 'lucide-react';
import { getNotificationDisplay } from '../notification-config';
import { NOTIFICATION_CATALOG, EMAIL_ELIGIBLE_TYPES } from '../notification-catalog';

describe('post_client_reference notification', () => {
  test('names the client and the post, with the paperclip', () => {
    const d = getNotificationDisplay('post_client_reference', {
      client_name: 'Clínica X',
      post_title: 'Post 1',
      workflow_id: 3,
      post_id: 9,
    });
    expect(d.icon).toBe(Paperclip);
    expect(d.tone).toBe('teal');
    expect(d.title).toBe('Clínica X enviou referências em Post 1');
    expect(d.body).toBe('');
  });

  test('falls back when the metadata is missing', () => {
    const d = getNotificationDisplay('post_client_reference', {});
    expect(d.title).toBe('Cliente enviou referências em Post');
  });

  test('appears in the in-app preferences as "Referências do cliente", never by e-mail', () => {
    expect(NOTIFICATION_CATALOG.post_client_reference).toEqual({
      category: 'aprovacoes_hub',
      label: 'Referências do cliente',
      when: 'o cliente anexa fotos, vídeos, PDFs ou links a um post no Hub',
      recipients: 'responsável pelo item + donos e admins',
      emailEligible: false,
    });
    expect(EMAIL_ELIGIBLE_TYPES).not.toContain('post_client_reference');
  });

  test('new copy has no em dash', () => {
    const d = getNotificationDisplay('post_client_reference', {
      client_name: 'A',
      post_title: 'B',
    });
    const entry = NOTIFICATION_CATALOG.post_client_reference;
    for (const text of [d.title, d.body, entry.label, entry.when, entry.recipients]) {
      expect(text).not.toMatch(/—/);
    }
  });
});
