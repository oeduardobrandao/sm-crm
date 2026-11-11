import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from 'i18next';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getConsent, openConsentPreferences, setConsent } from '@/lib/consent';
import { clearPendingSupportChat } from '@/lib/supportChat';
import { seedConsent } from '../../../test/consent';
import CookieConsent from '../CookieConsent';

vi.mock('@/lib/supportChat', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/supportChat')>()),
  clearPendingSupportChat: vi.fn(),
}));

const t = (key: string) => i18n.t(key);

function renderBanner() {
  return render(
    <MemoryRouter>
      <CookieConsent />
    </MemoryRouter>,
  );
}

describe('CookieConsent', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(clearPendingSupportChat).mockClear();
  });
  afterEach(() => localStorage.clear());

  it('shows the banner only while the visitor is undecided', () => {
    const { unmount } = renderBanner();
    expect(screen.getByRole('region', { name: t('cookies.banner.title') })).toBeInTheDocument();
    unmount();

    seedConsent({ analytics: true, support: true });
    renderBanner();
    expect(screen.queryByRole('region', { name: t('cookies.banner.title') })).toBeNull();
  });

  it('shows one short sentence and no visible title', () => {
    renderBanner();
    // The title only names the region for assistive tech; it is not rendered as text.
    const region = screen.getByRole('region', { name: 'Cookies e privacidade' });
    expect(region).toHaveTextContent('gravação de sessão');
    expect(within(region).getByRole('link', { name: 'Detalhes' })).toHaveAttribute('href', '/lgpd');
    expect(within(region).queryByText('Cookies e privacidade')).toBeNull();
  });

  it('offers Personalizar, Rejeitar and Aceitar', () => {
    renderBanner();
    const region = screen.getByRole('region', { name: t('cookies.banner.title') });
    expect(
      within(region)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Personalizar', 'Rejeitar', 'Aceitar']);
  });

  it('gives Aceitar and Rejeitar the same visual weight', () => {
    renderBanner();
    const accept = screen.getByRole('button', { name: 'Aceitar' });
    const reject = screen.getByRole('button', { name: 'Rejeitar' });
    expect(accept.className).toBe(reject.className);
    expect(accept.dataset.variant).toBe(reject.dataset.variant);
  });

  it('Aceitar stores every category as granted', async () => {
    renderBanner();
    await userEvent.click(screen.getByRole('button', { name: 'Aceitar' }));
    expect(getConsent()).toMatchObject({ analytics: true, support: true, marketing: true });
    expect(screen.queryByRole('region', { name: t('cookies.banner.title') })).toBeNull();
  });

  // App Store: ad tags inside the iOS app count as tracking (ATT), so the app never offers them.
  describe('inside the iOS app', () => {
    beforeEach(() =>
      vi.stubGlobal('Capacitor', { isNativePlatform: () => true, getPlatform: () => 'ios' }),
    );
    afterEach(() => vi.unstubAllGlobals());

    it('shows no banner and leaves consent undecided, so nothing non-essential loads', () => {
      renderBanner();
      expect(screen.queryByRole('region', { name: t('cookies.banner.title') })).toBeNull();
      expect(getConsent()).toBeNull();
    });

    it('Personalizar has no advertising switch and saves it as denied', async () => {
      seedConsent({ analytics: true, support: true, marketing: true });
      renderBanner();
      act(() => openConsentPreferences());
      const dialog = await screen.findByRole('dialog');
      expect(
        within(dialog).queryByRole('switch', { name: t('cookies.dialog.marketingTitle') }),
      ).toBeNull();
      await userEvent.click(within(dialog).getByRole('button', { name: t('cookies.dialog.save') }));
      expect(getConsent()).toMatchObject({ analytics: true, support: true, marketing: false });
    });
  });

  it('Rejeitar stores every category as denied', async () => {
    renderBanner();
    await userEvent.click(screen.getByRole('button', { name: 'Rejeitar' }));
    expect(getConsent()).toMatchObject({ analytics: false, support: false, marketing: false });
  });

  it('Personalizar lets the visitor grant one category and saves that choice', async () => {
    renderBanner();
    await userEvent.click(screen.getByRole('button', { name: 'Personalizar' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(
      within(dialog).getByRole('switch', { name: t('cookies.dialog.analyticsTitle') }),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: t('cookies.dialog.save') }));
    expect(getConsent()).toMatchObject({ analytics: true, support: false, marketing: false });
  });

  it('Customize lets the visitor grant advertising on its own', async () => {
    renderBanner();
    await userEvent.click(screen.getByRole('button', { name: t('cookies.banner.customize') }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(
      within(dialog).getByRole('switch', { name: t('cookies.dialog.marketingTitle') }),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: t('cookies.dialog.save') }));
    expect(getConsent()).toMatchObject({ analytics: false, support: false, marketing: true });
  });

  it('re-opens the preferences dialog after a decision (withdrawal must stay easy)', async () => {
    seedConsent({ analytics: true, support: true });
    renderBanner();
    act(() => openConsentPreferences());
    const dialog = await screen.findByRole('dialog');
    const analytics = within(dialog).getByRole('switch', {
      name: t('cookies.dialog.analyticsTitle'),
    });
    expect(analytics).toBeChecked();
    await userEvent.click(analytics);
    await userEvent.click(within(dialog).getByRole('button', { name: t('cookies.dialog.save') }));
    expect(getConsent()).toMatchObject({ analytics: false, support: true });
  });

  it('starts from the stored choice on every open, never from a previous abandoned edit', async () => {
    // Guards the mount-lifecycle assumption: PreferencesForm lives inside Radix Content, which
    // unmounts on close, so its useState initialisers must re-run on each open.
    seedConsent({ analytics: false, support: false });
    renderBanner();
    act(() => openConsentPreferences());
    let dialog = await screen.findByRole('dialog');
    await userEvent.click(
      within(dialog).getByRole('switch', { name: t('cookies.dialog.supportTitle') }),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: t('cookies.dialog.cancel') }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    act(() => setConsent({ analytics: true, support: false }));
    act(() => openConsentPreferences());
    dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByRole('switch', { name: t('cookies.dialog.analyticsTitle') }),
    ).toBeChecked();
    expect(
      within(dialog).getByRole('switch', { name: t('cookies.dialog.supportTitle') }),
    ).not.toBeChecked();
  });

  it('hands focus back to whatever opened the dialog (there is no Radix trigger to do it)', async () => {
    seedConsent({ analytics: true, support: true });
    render(
      <MemoryRouter>
        <button onClick={() => openConsentPreferences()}>opener</button>
        <CookieConsent />
      </MemoryRouter>,
    );
    const opener = screen.getByRole('button', { name: 'opener' });
    await userEvent.click(opener);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    await userEvent.click(within(dialog).getByRole('button', { name: t('cookies.dialog.cancel') }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it('pre-enables the support switch when opened from a blocked chat click', async () => {
    seedConsent({ analytics: false, support: false });
    renderBanner();
    act(() => openConsentPreferences('support'));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByRole('switch', { name: t('cookies.dialog.supportTitle') }),
    ).toBeChecked();
    expect(within(dialog).getByText(t('cookies.dialog.supportNeeded'))).toBeInTheDocument();
  });

  it('does not carry a support focus over to a later Customize open', async () => {
    renderBanner();
    act(() => openConsentPreferences('support'));
    let dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(t('cookies.dialog.supportNeeded'))).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: t('cookies.dialog.cancel') }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await userEvent.click(screen.getByRole('button', { name: t('cookies.banner.customize') }));
    dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByRole('switch', { name: t('cookies.dialog.supportTitle') }),
    ).not.toBeChecked();
    expect(within(dialog).queryByText(t('cookies.dialog.supportNeeded'))).toBeNull();
  });

  it('clears the pending chat request when a support-focused dialog is dismissed unsaved', async () => {
    seedConsent({ analytics: false, support: false });
    renderBanner();
    act(() => openConsentPreferences('support'));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: t('cookies.dialog.cancel') }));
    expect(clearPendingSupportChat).toHaveBeenCalled();
    expect(getConsent()).toMatchObject({ analytics: false, support: false });
  });
});
