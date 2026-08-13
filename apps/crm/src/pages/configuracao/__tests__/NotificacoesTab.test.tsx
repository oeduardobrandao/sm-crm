import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const setPref = vi.fn().mockResolvedValue(undefined);
vi.mock('../../../store', () => ({
  getNotificationEmailPrefs: vi.fn().mockResolvedValue({ mention: false }),
  setNotificationEmailPref: (...a: unknown[]) => setPref(...a),
  MASTER_PAUSE_TYPE: '__all__',
  EMAIL_NOTIFICATION_TYPES: [
    { type: 'post_publish_failed', label: 'Falha ao publicar', description: 'x' },
    { type: 'mention', label: 'Menções', description: 'y' },
  ],
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Radix Switch: mocked to a plain native checkbox (checked/onCheckedChange/
// disabled/aria-label), same convention as MembrosTab.test.tsx and
// TikTokSettingsPanel.test.tsx's Switch mock, so toggling can be driven with a
// plain fireEvent.click and asserted via `.checked`.
vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    checked,
    onCheckedChange,
    disabled,
    'aria-label': ariaLabel,
  }: {
    checked?: boolean;
    onCheckedChange?: (checked: boolean) => void;
    disabled?: boolean;
    'aria-label'?: string;
  }) => (
    <input
      type="checkbox"
      role="switch"
      aria-label={ariaLabel}
      checked={checked ?? false}
      disabled={disabled}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
    />
  ),
}));

import NotificacoesTab from '../tabs/NotificacoesTab';
import { getNotificationEmailPrefs } from '../../../store';

function renderTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NotificacoesTab />
    </QueryClientProvider>,
  );
}

describe('NotificacoesTab', () => {
  beforeEach(() => {
    // The suite-wide afterEach (test/vitest.setup.ts) calls vi.restoreAllMocks(),
    // which wipes vi.fn() implementations (including these vi.mock factory
    // mocks) down to a no-op returning undefined after every test: not just
    // their call history. Re-establishing the base implementation here (not
    // just clearing calls) keeps every test's queryFn resolving a real value
    // regardless of test order.
    setPref.mockReset().mockResolvedValue(undefined);
    vi.mocked(getNotificationEmailPrefs).mockReset().mockResolvedValue({ mention: false });
  });

  it('reflects stored prefs (mention off) and toggling calls the setter', async () => {
    renderTab();
    // mention comes seeded false; the publish-failure default is on.
    const mention = await screen.findByLabelText('Menções');
    expect((mention as HTMLInputElement).checked).toBe(false);
    fireEvent.click(mention);
    await waitFor(() => expect(setPref).toHaveBeenCalledWith('mention', true));
    // onSettled invalidates the prefs query, triggering a background refetch.
    // Wait for it here so nothing leaks past this test's teardown (afterEach
    // resets all mocks, which would otherwise make a late in-flight refetch
    // resolve against a reset mock and log a stray warning during the next test).
    await waitFor(() => expect(getNotificationEmailPrefs).toHaveBeenCalledTimes(2));
  });

  it('renders the master pause switch unchecked when nothing is paused, and turning it on stores enabled=false', async () => {
    vi.mocked(getNotificationEmailPrefs).mockResolvedValueOnce({});
    renderTab();
    const master = await screen.findByLabelText('Pausar todos os e-mails');
    expect((master as HTMLInputElement).checked).toBe(false);
    fireEvent.click(master);
    await waitFor(() => expect(setPref).toHaveBeenCalledWith('__all__', false));
    await waitFor(() => expect(getNotificationEmailPrefs).toHaveBeenCalledTimes(2));
  });
});
