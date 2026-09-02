import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NOTIFICATION_CATALOG, CATEGORY_ORDER, CATEGORY_LABELS } from '@/lib/notification-catalog';

// Real catalog + category constants (Task 3) are pure static data: kept real
// here so the "5 groups / 22 rows" assertions exercise the actual catalog,
// not a stand-in. Only the prefs store (network calls) is mocked.
const getInapp = vi.fn();
const setInapp = vi.fn().mockResolvedValue(undefined);
const getEmail = vi.fn();
const setEmail = vi.fn().mockResolvedValue(undefined);

vi.mock('@/store/notificationPrefs', () => ({
  getNotificationInappPrefs: (...a: unknown[]) => getInapp(...a),
  setNotificationInappPref: (...a: unknown[]) => setInapp(...a),
  getNotificationEmailPrefs: (...a: unknown[]) => getEmail(...a),
  setNotificationEmailPref: (...a: unknown[]) => setEmail(...a),
  MASTER_PAUSE_TYPE: '__all__',
}));

// Only the exported query-key constant is needed here; mocking the hook
// module directly avoids dragging in its own store imports for this test.
vi.mock('@/hooks/useNotifications', () => ({
  INAPP_PREFS_KEY: ['notification-inapp-prefs'],
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Radix Switch: mocked to a plain native checkbox (checked/onCheckedChange/
// disabled/aria-label), same convention as MembrosTab.test.tsx and the
// previous NotificacoesTab.test.tsx, so toggling can be driven with a plain
// fireEvent.click and asserted via `.checked`.
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
    // which wipes vi.fn() implementations down to a no-op returning undefined
    // after every test. Re-establishing the base implementation here keeps
    // every test's queryFn resolving a real value regardless of test order.
    getInapp.mockReset().mockResolvedValue({});
    setInapp.mockReset().mockResolvedValue(undefined);
    getEmail.mockReset().mockResolvedValue({});
    setEmail.mockReset().mockResolvedValue(undefined);
  });

  it('renders the 5 CATEGORY_LABELS groups and all 22 catalog type rows', async () => {
    renderTab();
    for (const category of CATEGORY_ORDER) {
      expect(await screen.findByText(CATEGORY_LABELS[category])).toBeInTheDocument();
    }
    expect(CATEGORY_ORDER.length).toBe(5);
    expect(Object.keys(NOTIFICATION_CATALOG).length).toBe(22);
    for (const entry of Object.values(NOTIFICATION_CATALOG)) {
      expect(screen.getByText(entry.label)).toBeInTheDocument();
    }
  });

  it('does not render an email switch for a non-eligible type (idea_submitted), showing "·" instead', async () => {
    renderTab();
    const label = NOTIFICATION_CATALOG.idea_submitted.label;
    await screen.findByText(label);
    expect(screen.queryByLabelText(`${label} (e-mail)`)).not.toBeInTheDocument();
    expect(screen.getAllByTitle('Este tipo não vira e-mail').length).toBeGreaterThan(0);
  });

  it('toggling the in-app switch for "mention" calls setNotificationInappPref(mention, false)', async () => {
    renderTab();
    const label = NOTIFICATION_CATALOG.mention.label;
    const switchEl = await screen.findByLabelText(`${label} (no app)`);
    expect((switchEl as HTMLInputElement).checked).toBe(true); // no row = default on
    fireEvent.click(switchEl);
    await waitFor(() => expect(setInapp).toHaveBeenCalledWith('mention', false));
  });

  it('flips the switch immediately on click (optimistic) and rolls back if the save fails', async () => {
    // A never-(yet-)resolving promise stands in for a slow round trip: the
    // switch must flip the instant the click fires, well before this
    // resolves, then revert once it's rejected.
    let rejectSave: (err: Error) => void = () => {};
    setInapp.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectSave = reject;
        }),
    );

    renderTab();
    const label = NOTIFICATION_CATALOG.mention.label;
    const switchEl = (await screen.findByLabelText(`${label} (no app)`)) as HTMLInputElement;
    expect(switchEl.checked).toBe(true); // no row = default on

    fireEvent.click(switchEl);
    // Optimistic: flips synchronously (well ahead of the pending save).
    await waitFor(() => expect(switchEl.checked).toBe(false));
    expect(setInapp).toHaveBeenCalledWith('mention', false);

    rejectSave(new Error('save failed'));
    // Rollback: reverts to the pre-click state once the save errors out.
    await waitFor(() => expect(switchEl.checked).toBe(true));
  });

  it('toggling the email switch for "post_approved" calls setNotificationEmailPref(post_approved, false)', async () => {
    renderTab();
    const label = NOTIFICATION_CATALOG.post_approved.label;
    const switchEl = await screen.findByLabelText(`${label} (e-mail)`);
    expect((switchEl as HTMLInputElement).checked).toBe(true); // no row = default on
    fireEvent.click(switchEl);
    await waitFor(() => expect(setEmail).toHaveBeenCalledWith('post_approved', false));
  });

  it('the "Pausar tudo" master row calls the setter of the channel that was toggled', async () => {
    renderTab();
    const masterInapp = await screen.findByLabelText('Pausar tudo (no app)');
    expect((masterInapp as HTMLInputElement).checked).toBe(false);
    fireEvent.click(masterInapp);
    await waitFor(() => expect(setInapp).toHaveBeenCalledWith('__all__', false));
    expect(setEmail).not.toHaveBeenCalled();

    const masterEmail = screen.getByLabelText('Pausar tudo (e-mail)');
    expect((masterEmail as HTMLInputElement).checked).toBe(false);
    fireEvent.click(masterEmail);
    await waitFor(() => expect(setEmail).toHaveBeenCalledWith('__all__', false));
  });

  it('renders default state (no row for the type) as switched on, for both channels', async () => {
    renderTab();
    const label = NOTIFICATION_CATALOG.post_publish_failed.label;
    const inapp = await screen.findByLabelText(`${label} (no app)`);
    const email = screen.getByLabelText(`${label} (e-mail)`);
    expect((inapp as HTMLInputElement).checked).toBe(true);
    expect((email as HTMLInputElement).checked).toBe(true);
  });
});
