import { beforeEach, describe, expect, it, vi } from 'vitest';

const { from, getUserId } = vi.hoisted(() => ({ from: vi.fn(), getUserId: vi.fn() }));

vi.mock('@/store/core', () => ({ supabase: { from }, getUserId }));

import {
  getNotificationPushPrefs,
  hasActivePushDevice,
  setNotificationPushPref,
} from '@/store/notificationPrefs';

describe('notificationPrefs: push', () => {
  beforeEach(() => {
    from.mockReset();
    getUserId.mockReset().mockResolvedValue('user-1');
  });

  it('getNotificationPushPrefs maps rows of notification_push_prefs to type -> enabled', async () => {
    const select = vi.fn().mockResolvedValue({
      data: [
        { type: 'mention', enabled: false },
        { type: '__all__', enabled: true },
      ],
      error: null,
    });
    from.mockReturnValue({ select });
    await expect(getNotificationPushPrefs()).resolves.toEqual({ mention: false, __all__: true });
    expect(from).toHaveBeenCalledWith('notification_push_prefs');
    expect(select).toHaveBeenCalledWith('type, enabled');
  });

  it('setNotificationPushPref upserts by (user_id, type)', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    from.mockReturnValue({ upsert });
    await setNotificationPushPref('mention', false);
    expect(from).toHaveBeenCalledWith('notification_push_prefs');
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1', type: 'mention', enabled: false }),
      { onConflict: 'user_id,type' },
    );
  });

  it('setNotificationPushPref throws the error the upsert returns', async () => {
    from.mockReturnValue({ upsert: vi.fn().mockResolvedValue({ error: new Error('nope') }) });
    await expect(setNotificationPushPref('__all__', false)).rejects.toThrow('nope');
  });

  function devicesQuery(result: { data: unknown[] | null; error: unknown }) {
    const limit = vi.fn().mockResolvedValue(result);
    const is = vi.fn(() => ({ limit }));
    const select = vi.fn(() => ({ is }));
    from.mockReturnValue({ select });
    return { select, is, limit };
  }

  it('hasActivePushDevice reads one own active row, never the token', async () => {
    const q = devicesQuery({ data: [{ id: 'd1' }], error: null });
    await expect(hasActivePushDevice()).resolves.toBe(true);
    expect(from).toHaveBeenCalledWith('push_devices');
    // `token` and `user_id` are outside the column grant; RLS limits to own rows.
    expect(q.select).toHaveBeenCalledWith('id');
    expect(q.is).toHaveBeenCalledWith('disabled_at', null);
    expect(q.limit).toHaveBeenCalledWith(1);
  });

  it('hasActivePushDevice is false with no rows', async () => {
    devicesQuery({ data: [], error: null });
    await expect(hasActivePushDevice()).resolves.toBe(false);
  });

  it('hasActivePushDevice throws on error', async () => {
    devicesQuery({ data: null, error: new Error('boom') });
    await expect(hasActivePushDevice()).rejects.toThrow('boom');
  });
});
