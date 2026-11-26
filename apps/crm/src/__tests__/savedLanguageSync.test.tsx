import { render, waitFor } from '@testing-library/react';
import i18n from 'i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SavedLanguageSync } from '../boot/SavedLanguageSync';
import { EnglishPage } from '../pages/en/EnglishPage';

const KEY = 'mesaas-language';

function visit(pathname: string) {
  window.history.replaceState(null, '', pathname);
}

// SavedLanguageSync applies the saved language after the prerendered landing hydrates. The /en
// pages are English whatever the visitor saved: there it must stay out of the way, and the page
// wrapper (EnglishPage) sets and persists English instead.
describe('SavedLanguageSync', () => {
  afterEach(async () => {
    visit('/');
    localStorage.removeItem(KEY);
    await i18n.changeLanguage('pt');
  });

  it('never switches an /en page back to the saved language', async () => {
    await i18n.changeLanguage('en');
    localStorage.setItem(KEY, 'pt');
    visit('/en');
    const seen: string[] = [];
    const onChange = (lng: string) => void seen.push(lng);
    i18n.on('languageChanged', onChange);
    try {
      render(<SavedLanguageSync />);
      await new Promise((r) => setTimeout(r, 20));
      expect(seen).not.toContain('pt');
      expect(i18n.language).toBe('en');
    } finally {
      i18n.off('languageChanged', onChange);
    }
  });

  it('on /en with saved pt, ends in English and saves en', async () => {
    localStorage.setItem(KEY, 'pt');
    visit('/en');
    render(
      <>
        <SavedLanguageSync />
        <EnglishPage>
          <div>page</div>
        </EnglishPage>
      </>,
    );
    await waitFor(() => expect(i18n.language).toBe('en'));
    expect(localStorage.getItem(KEY)).toBe('en');
  });

  it('on /en/pricing also leaves the language alone', async () => {
    await i18n.changeLanguage('en');
    localStorage.setItem(KEY, 'pt');
    visit('/en/pricing');
    const spy = vi.spyOn(i18n, 'changeLanguage');
    try {
      render(<SavedLanguageSync />);
      await new Promise((r) => setTimeout(r, 20));
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('on / applies a saved en', async () => {
    localStorage.setItem(KEY, 'en');
    visit('/');
    render(<SavedLanguageSync />);
    await waitFor(() => expect(i18n.language).toBe('en'));
  });

  it('on / with nothing saved stays pt', async () => {
    visit('/');
    render(<SavedLanguageSync />);
    await new Promise((r) => setTimeout(r, 20));
    expect(i18n.language).toBe('pt');
  });
});
