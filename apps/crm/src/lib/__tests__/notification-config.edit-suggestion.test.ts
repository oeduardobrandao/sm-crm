import { describe, expect, test } from 'vitest';
import { getNotificationDisplay } from '../notification-config';

describe('post_edit_suggestion notification', () => {
  test('first suggestion keeps the original title', () => {
    const d = getNotificationDisplay('post_edit_suggestion', {
      client_name: 'Clínica X',
      post_title: 'Post 1',
      updated: false,
    });
    expect(d.title).toBe('Sugestão de edição do cliente');
  });

  test('an updated suggestion says so', () => {
    const d = getNotificationDisplay('post_edit_suggestion', {
      client_name: 'Clínica X',
      post_title: 'Post 1',
      updated: true,
    });
    expect(d.title).toBe('Sugestão de edição atualizada');
  });

  test('older notifications without the flag read as a first suggestion', () => {
    const d = getNotificationDisplay('post_edit_suggestion', { client_name: 'X', post_title: 'P' });
    expect(d.title).toBe('Sugestão de edição do cliente');
  });
});
