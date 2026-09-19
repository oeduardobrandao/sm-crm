import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from 'i18next';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getConsent, openConsentPreferences, setConsent } from '@/lib/consent';
import { seedConsent } from '../../../test/consent';
import CookieConsent from '../CookieConsent';

const t = (key: string) => i18n.t(key);

function renderBanner() {
  return render(
    <MemoryRouter>
      <CookieConsent />
    </MemoryRouter>,
  );
}

describe('CookieConsent', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('shows the banner only while the visitor is undecided', () => {
    const { unmount } = renderBanner();
    expect(screen.getByRole('region', { name: t('cookies.banner.title') })).toBeInTheDocument();
    unmount();

    seedConsent({ analytics: true, support: true });
    renderBanner();
    expect(screen.queryByRole('region', { name: t('cookies.banner.title') })).toBeNull();
  });

  it('gives Accept all and Reject all the same visual weight', () => {
    renderBanner();
    const accept = screen.getByRole('button', { name: t('cookies.banner.acceptAll') });
    const reject = screen.getByRole('button', { name: t('cookies.banner.rejectAll') });
    expect(accept.className).toBe(reject.className);
  });

  it('Accept all stores both categories as granted', async () => {
    renderBanner();
    await userEvent.click(screen.getByRole('button', { name: t('cookies.banner.acceptAll') }));
    expect(getConsent()).toMatchObject({ analytics: true, support: true });
    expect(screen.queryByRole('region', { name: t('cookies.banner.title') })).toBeNull();
  });

  it('Reject all stores both categories as denied', async () => {
    renderBanner();
    await userEvent.click(screen.getByRole('button', { name: t('cookies.banner.rejectAll') }));
    expect(getConsent()).toMatchObject({ analytics: false, support: false });
  });

  it('Customize lets the visitor grant one category and saves that choice', async () => {
    renderBanner();
    await userEvent.click(screen.getByRole('button', { name: t('cookies.banner.customize') }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(
      within(dialog).getByRole('switch', { name: t('cookies.dialog.analyticsTitle') }),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: t('cookies.dialog.save') }));
    expect(getConsent()).toMatchObject({ analytics: true, support: false });
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
});
