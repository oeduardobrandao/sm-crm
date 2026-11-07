import { fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { plugin } = vi.hoisted(() => ({
  plugin: {
    checkPermissions: vi.fn(),
    requestPermissions: vi.fn(),
    register: vi.fn(async () => {}),
    addListener: vi.fn(async () => ({ remove: vi.fn(async () => {}) })),
  },
}));

vi.mock('@capacitor/push-notifications', () => ({ PushNotifications: plugin }));
vi.mock('../../lib/supabase', () => ({
  supabase: { rpc: vi.fn(async () => ({ data: null, error: null })) },
}));

import { PushPermissionRow } from '../PushPermissionRow';

const native = {
  keychainGet: vi.fn(async () => ({ value: null })),
  keychainSet: vi.fn(async () => {}),
  keychainRemove: vi.fn(async () => {}),
  deviceInfo: vi.fn(async () => ({ pushEnvironment: 'sandbox', appVersion: '1.0.0' })),
  openSettings: vi.fn(async () => {}),
  openUrl: vi.fn(async () => {}),
};

function setBridge(nativeApp: boolean) {
  (window as unknown as { Capacitor?: unknown }).Capacitor = nativeApp
    ? {
        isNativePlatform: () => true,
        getPlatform: () => 'ios',
        isPluginAvailable: (name: string) =>
          name === 'PushNotifications' || name === 'MesaasNative',
        Plugins: { MesaasNative: native },
      }
    : undefined;
}

beforeEach(() => {
  vi.clearAllMocks();
  setBridge(true);
  plugin.requestPermissions.mockResolvedValue({ receive: 'granted' });
});

afterEach(() => setBridge(false));

describe('PushPermissionRow', () => {
  it('renders nothing when permission is granted', async () => {
    plugin.checkPermissions.mockResolvedValue({ receive: 'granted' });
    const { container } = render(<PushPermissionRow />);
    await waitFor(() => expect(plugin.checkPermissions).toHaveBeenCalled());
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing on the web', async () => {
    setBridge(false);
    const { container } = render(<PushPermissionRow />);
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
    expect(plugin.checkPermissions).not.toHaveBeenCalled();
  });

  it('offers "Ativar" while undecided, then hides and reports the change', async () => {
    plugin.checkPermissions.mockResolvedValue({ receive: 'prompt' });
    const onEnabled = vi.fn();
    render(<PushPermissionRow onEnabled={onEnabled} />);
    expect(await screen.findByText('Notificações desligadas neste iPhone')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ativar' }));
    await waitFor(() => expect(onEnabled).toHaveBeenCalledTimes(1));
    expect(plugin.register).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByText('Notificações desligadas neste iPhone')).toBeNull(),
    );
  });

  it('offers "Abrir Ajustes" once iOS permission is denied', async () => {
    plugin.checkPermissions.mockResolvedValue({ receive: 'denied' });
    render(<PushPermissionRow />);
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir Ajustes' }));
    await waitFor(() => expect(native.openSettings).toHaveBeenCalledTimes(1));
    expect(plugin.requestPermissions).not.toHaveBeenCalled();
  });

  it('phone variant renders as a grouped-list cell', async () => {
    plugin.checkPermissions.mockResolvedValue({ receive: 'denied' });
    render(<PushPermissionRow variant="phone" />);
    expect(await screen.findByText('Notificações desligadas neste iPhone')).toBeInTheDocument();
    expect(screen.getByText('Abrir Ajustes')).toBeInTheDocument();
  });
});
