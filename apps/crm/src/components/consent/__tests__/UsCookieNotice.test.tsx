import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18n from 'i18next';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OPEN_PREFERENCES_EVENT } from '@/lib/consent';
import { doNotSellOrShare } from '@/lib/usConsentDefault';
import UsCookieNotice from '../UsCookieNotice';

vi.mock('@/lib/usConsentDefault', () => ({ doNotSellOrShare: vi.fn() }));

const NOTICE = 'We use cookies for analytics and advertising.';
const DISMISS_KEY = 'us_cookie_notice_dismissed';

function tree(path = '/en') {
  return (
    <MemoryRouter initialEntries={[path]}>
      <UsCookieNotice />
    </MemoryRouter>
  );
}

describe('UsCookieNotice', () => {
  beforeEach(async () => {
    localStorage.clear();
    vi.mocked(doNotSellOrShare).mockClear();
    await i18n.changeLanguage('en');
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    await i18n.changeLanguage('pt');
  });

  it('is never in the server-rendered HTML (client-only, so hydration cannot mismatch)', () => {
    expect(renderToStaticMarkup(tree())).not.toContain(NOTICE);
  });

  it('shows the notice and both links after mount on an /en page', async () => {
    render(tree());
    expect(await screen.findByText(NOTICE)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Do Not Sell or Share My Personal Information' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cookie settings' })).toBeInTheDocument();
  });

  it('does not render on Brazilian pages', () => {
    render(tree('/'));
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  it('does not render inside the iOS app', () => {
    vi.stubGlobal('Capacitor', { isNativePlatform: () => true, getPlatform: () => 'ios' });
    render(tree());
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  it('"Do Not Sell or Share" calls doNotSellOrShare', async () => {
    render(tree());
    await userEvent.click(
      await screen.findByRole('button', { name: 'Do Not Sell or Share My Personal Information' }),
    );
    expect(doNotSellOrShare).toHaveBeenCalledTimes(1);
  });

  it('"Cookie settings" opens the preferences dialog', async () => {
    const handler = vi.fn();
    window.addEventListener(OPEN_PREFERENCES_EVENT, handler);
    render(tree());
    await userEvent.click(await screen.findByRole('button', { name: 'Cookie settings' }));
    window.removeEventListener(OPEN_PREFERENCES_EVENT, handler);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('dismiss hides it and keeps it dismissed in this browser', async () => {
    const { unmount } = render(tree());
    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(NOTICE)).toBeNull();
    expect(localStorage.getItem(DISMISS_KEY)).not.toBeNull();
    unmount();
    render(tree());
    // Give the mount effect its turn, then confirm it stayed hidden.
    await Promise.resolve();
    expect(screen.queryByText(NOTICE)).toBeNull();
  });

  it('survives storage that throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    render(tree());
    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(NOTICE)).toBeNull();
  });
});
