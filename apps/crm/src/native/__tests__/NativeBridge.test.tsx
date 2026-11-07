import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { plugin, rpc, auth, markRead } = vi.hoisted(() => {
  const plugin = {
    checkPermissions: vi.fn(),
    requestPermissions: vi.fn(),
    register: vi.fn(async () => {}),
    addListener: vi.fn(async (_name: string, _fn: (arg: unknown) => void) => ({
      remove: vi.fn(async () => {}),
    })),
  };
  return {
    plugin,
    rpc: vi.fn(),
    auth: { user: { id: 'user-a' } as { id: string } | null },
    markRead: vi.fn(async (_id: string) => {}),
  };
});

vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: plugin }));
vi.mock('../../lib/supabase', () => ({ supabase: { rpc } }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => auth }));
vi.mock('../../store/notifications', () => ({ markNotificationAsRead: markRead }));
vi.mock('../push', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../push')>();
  return { ...actual, syncNativePush: vi.fn(actual.syncNativePush) };
});

import NativeBridge from '../NativeBridge';
import { syncNativePush } from '../push';

const keychain = new Map<string, string>();
const native = {
  keychainGet: vi.fn(async ({ key }: { key: string }) => ({ value: keychain.get(key) ?? null })),
  keychainSet: vi.fn(async ({ key, value }: { key: string; value: string }) => {
    keychain.set(key, value);
  }),
  keychainRemove: vi.fn(async ({ key }: { key: string }) => {
    keychain.delete(key);
  }),
  deviceInfo: vi.fn(async () => ({ pushEnvironment: 'sandbox', appVersion: '1.0.0' })),
  openSettings: vi.fn(async () => {}),
  openUrl: vi.fn(async () => {}),
};

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="path">{location.pathname + location.search}</div>;
}

function tree(queryClient: QueryClient) {
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <NativeBridge />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function listener(name: string) {
  const index = plugin.addListener.mock.calls.findIndex(([n]) => n === name);
  return plugin.addListener.mock.calls[index]?.[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  keychain.clear();
  localStorage.clear();
  auth.user = { id: 'user-a' };
  (window as unknown as { Capacitor?: unknown }).Capacitor = {
    isNativePlatform: () => true,
    getPlatform: () => 'ios',
    isPluginAvailable: (name: string) => name === 'PushNotifications' || name === 'MesaasNative',
    Plugins: { MesaasNative: native },
  };
  rpc.mockResolvedValue({ data: null, error: null });
  plugin.checkPermissions.mockResolvedValue({ receive: 'granted' });
  plugin.requestPermissions.mockResolvedValue({ receive: 'granted' });
});

afterEach(() => {
  (window as unknown as { Capacitor?: unknown }).Capacitor = undefined;
});

describe('NativeBridge', () => {
  it('adds the three listeners once per mount and removes them on unmount', async () => {
    const qc = new QueryClient();
    const view = render(tree(qc));
    await waitFor(() => expect(syncNativePush).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(plugin.register).toHaveBeenCalled());
    const names = plugin.addListener.mock.calls.map(([n]) => n).sort();
    expect(names).toEqual(['pushNotificationActionPerformed', 'registration', 'registrationError']);

    view.unmount();
    const handles = await Promise.all(plugin.addListener.mock.results.map((r) => r.value));
    await waitFor(() => {
      for (const h of handles) expect(h.remove).toHaveBeenCalledTimes(1);
    });
  });

  it('re-runs syncNativePush when the user changes', async () => {
    const qc = new QueryClient();
    const view = render(tree(qc));
    await waitFor(() => expect(syncNativePush).toHaveBeenCalledTimes(1));

    auth.user = { id: 'user-b' };
    view.rerender(tree(qc));
    await waitFor(() => expect(syncNativePush).toHaveBeenCalledTimes(2));
    expect(plugin.addListener).toHaveBeenCalledTimes(3);
  });

  it('routes a tap, marks it read and refreshes the bell', async () => {
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    render(tree(qc));
    await waitFor(() => expect(listener('pushNotificationActionPerformed')).toBeDefined());

    act(() => {
      listener('pushNotificationActionPerformed')!({
        actionId: 'tap',
        notification: { id: 'x', data: { link: '/entregas?post=7', notification_id: 'n9' } },
      });
    });

    await waitFor(() => expect(screen.getByTestId('path').textContent).toBe('/entregas?post=7'));
    expect(markRead).toHaveBeenCalledWith('n9');
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['notifications-unread-count'] }),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['notifications'] });
  });

  it('shows the pre-prompt while permission is undecided; "Agora não" snoozes 7 days', async () => {
    plugin.checkPermissions.mockResolvedValue({ receive: 'prompt' });
    render(tree(new QueryClient()));
    const later = await screen.findByRole('button', { name: 'Agora não' });
    expect(screen.getByText('Receber avisos no celular?')).toBeInTheDocument();

    const before = Date.now();
    fireEvent.click(later);
    await waitFor(() => expect(screen.queryByText('Receber avisos no celular?')).toBeNull());
    const until = Number(localStorage.getItem('mesaas.pushPrePrompt.snoozedUntil'));
    expect(until).toBeGreaterThanOrEqual(before + 7 * 24 * 60 * 60 * 1000);
    expect(plugin.requestPermissions).not.toHaveBeenCalled();
  });

  it('"Ativar notificações" asks iOS and registers', async () => {
    plugin.checkPermissions.mockResolvedValue({ receive: 'prompt' });
    render(tree(new QueryClient()));
    fireEvent.click(await screen.findByRole('button', { name: 'Ativar notificações' }));
    await waitFor(() => expect(plugin.requestPermissions).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(plugin.register).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText('Receber avisos no celular?')).toBeNull());
  });

  it('never shows the pre-prompt once iOS permission is denied', async () => {
    plugin.checkPermissions.mockResolvedValue({ receive: 'denied' });
    render(tree(new QueryClient()));
    await waitFor(() => expect(syncNativePush).toHaveBeenCalled());
    await waitFor(() => expect(plugin.checkPermissions).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(screen.queryByText('Receber avisos no celular?')).toBeNull();
  });

  it('does not show the pre-prompt during a snooze', async () => {
    plugin.checkPermissions.mockResolvedValue({ receive: 'prompt' });
    localStorage.setItem('mesaas.pushPrePrompt.snoozedUntil', String(Date.now() + 60_000));
    render(tree(new QueryClient()));
    await waitFor(() => expect(plugin.checkPermissions).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(screen.queryByText('Receber avisos no celular?')).toBeNull();
  });
});
