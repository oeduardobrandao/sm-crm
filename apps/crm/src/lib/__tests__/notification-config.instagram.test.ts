import { describe, expect, test } from 'vitest';
import { getNotificationDisplay } from '../notification-config';

describe('instagram_connected_by_client notification', () => {
  test('names the client and the connected account', () => {
    const d = getNotificationDisplay('instagram_connected_by_client', {
      client_name: 'Clínica X',
      ig_username: 'clinicax',
    });
    expect(d.title).toBe('Instagram conectado pelo cliente');
    expect(d.body).toBe('Clínica X · @clinicax');
  });

  test('falls back cleanly when metadata is missing', () => {
    const d = getNotificationDisplay('instagram_connected_by_client', {});
    expect(d.body).toBe('Cliente');
  });

  test('no em-dash in the copy', () => {
    const d = getNotificationDisplay('instagram_connected_by_client', {
      client_name: 'Clínica X',
      ig_username: 'clinicax',
    });
    expect(`${d.title}${d.body}`).not.toContain('—');
  });
});
