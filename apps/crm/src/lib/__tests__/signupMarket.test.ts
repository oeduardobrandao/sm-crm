import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@mesaas/i18n', () => ({ changeLanguage: vi.fn() }));

import { changeLanguage } from '@mesaas/i18n';
import { applyAccountLanguageFallback, readSignupMarket } from '../signupMarket';

const mockedChangeLanguage = vi.mocked(changeLanguage);

describe('readSignupMarket', () => {
  it('honors only an exact single market=us', () => {
    expect(readSignupMarket('?market=us')).toBe('us');
    expect(readSignupMarket('?tab=register&market=us&plan=pro')).toBe('us');
  });

  it.each(['?market=US', '?market=us%20', '?market=br', '?market=us&market=br', '?market=', ''])(
    'ignores %j',
    (search) => {
      expect(readSignupMarket(search)).toBeUndefined();
    },
  );
});

describe('applyAccountLanguageFallback', () => {
  beforeEach(() => {
    localStorage.clear();
    mockedChangeLanguage.mockReset();
  });
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  const usUser = { user_metadata: { market: 'us' } };

  it('switches to English when nothing is saved and the account is a US signup', () => {
    applyAccountLanguageFallback(usUser);
    expect(mockedChangeLanguage).toHaveBeenCalledWith('en');
  });

  it('keeps a saved language', () => {
    localStorage.setItem('mesaas-language', 'pt');
    applyAccountLanguageFallback(usUser);
    expect(mockedChangeLanguage).not.toHaveBeenCalled();
  });

  it('treats an invalid saved value as nothing saved', () => {
    localStorage.setItem('mesaas-language', 'fr');
    applyAccountLanguageFallback(usUser);
    expect(mockedChangeLanguage).toHaveBeenCalledWith('en');
  });

  it('does nothing without market us', () => {
    applyAccountLanguageFallback({ user_metadata: {} });
    applyAccountLanguageFallback({ user_metadata: { market: 'US' } });
    applyAccountLanguageFallback({});
    applyAccountLanguageFallback(null);
    expect(mockedChangeLanguage).not.toHaveBeenCalled();
  });

  it('never throws when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    mockedChangeLanguage.mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => applyAccountLanguageFallback(usUser)).not.toThrow();
  });
});
