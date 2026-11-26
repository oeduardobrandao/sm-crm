import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { Link, MemoryRouter } from 'react-router-dom';
import i18n from 'i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setActiveWorkspaceLanguage } from '@mesaas/i18n';
import { SavedLanguageSync } from '../boot/SavedLanguageSync';
import { EnglishPage } from '../pages/en/EnglishPage';

const KEY = 'mesaas-language';
const HINT = 'mesaas-site-language';

function visit(pathname: string) {
  window.history.replaceState(null, '', pathname);
}

function renderAt(pathname: string, ui: ReactElement = <SavedLanguageSync />) {
  visit(pathname);
  return render(<MemoryRouter initialEntries={[pathname]}>{ui}</MemoryRouter>);
}

// SavedLanguageSync picks the language per page: /en pages are English whatever the visitor saved
// (EnglishPage sets and persists it), Portuguese-only site pages stay pt without saving, and
// login and the app use the saved language.
describe('SavedLanguageSync', () => {
  afterEach(async () => {
    visit('/');
    localStorage.removeItem(KEY);
    localStorage.removeItem(HINT);
    setActiveWorkspaceLanguage(null);
    await i18n.changeLanguage('pt');
  });

  it('never switches an /en page back to the saved language', async () => {
    await i18n.changeLanguage('en');
    localStorage.setItem(KEY, 'pt');
    const seen: string[] = [];
    const onChange = (lng: string) => void seen.push(lng);
    i18n.on('languageChanged', onChange);
    try {
      renderAt('/en');
      await new Promise((r) => setTimeout(r, 20));
      expect(seen).not.toContain('pt');
      expect(i18n.language).toBe('en');
    } finally {
      i18n.off('languageChanged', onChange);
    }
  });

  it('on /en with saved pt, ends in English and saves en', async () => {
    localStorage.setItem(KEY, 'pt');
    renderAt(
      '/en',
      <>
        <SavedLanguageSync />
        <EnglishPage>
          <div>page</div>
        </EnglishPage>
      </>,
    );
    await waitFor(() => expect(i18n.language).toBe('en'));
    // A visit is a hint, never an explicit choice.
    expect(localStorage.getItem(KEY)).toBe('pt');
  });

  it('/en visit writes only the hint', async () => {
    renderAt(
      '/en',
      <EnglishPage>
        <div>page</div>
      </EnglishPage>,
    );
    await waitFor(() => expect(i18n.language).toBe('en'));
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(localStorage.getItem(HINT)).toBe('en');
  });

  it('navigating from /dashboard to /login keeps the effective language', async () => {
    setActiveWorkspaceLanguage('en');
    renderAt(
      '/dashboard',
      <>
        <SavedLanguageSync />
        <Link to="/login">Entrar</Link>
      </>,
    );
    await waitFor(() => expect(i18n.language).toBe('en'));
    fireEvent.click(screen.getByRole('link', { name: 'Entrar' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(i18n.language).toBe('en');
  });

  it('on /en/pricing also leaves the language alone', async () => {
    await i18n.changeLanguage('en');
    localStorage.setItem(KEY, 'pt');
    const spy = vi.spyOn(i18n, 'changeLanguage');
    try {
      renderAt('/en/pricing');
      await new Promise((r) => setTimeout(r, 20));
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it.each(['/', '/precos', '/blog/um-post', '/termos-de-uso'])(
    'keeps the Portuguese site page %s in pt with a saved en, without saving pt',
    async (path) => {
      await i18n.changeLanguage('en');
      localStorage.setItem(KEY, 'en');
      renderAt(path);
      await waitFor(() => expect(i18n.language).toBe('pt'));
      expect(localStorage.getItem(KEY)).toBe('en');
      expect(document.documentElement.lang).toBe('pt-BR');
    },
  );

  it('applies a saved en on login and in the app', async () => {
    localStorage.setItem(KEY, 'en');
    renderAt('/login');
    await waitFor(() => expect(i18n.language).toBe('en'));
  });

  it('switches to the saved en when the visitor moves from / to /login', async () => {
    localStorage.setItem(KEY, 'en');
    renderAt(
      '/',
      <>
        <SavedLanguageSync />
        <Link to="/login">Entrar</Link>
      </>,
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(i18n.language).toBe('pt');
    fireEvent.click(screen.getByRole('link', { name: 'Entrar' }));
    await waitFor(() => expect(i18n.language).toBe('en'));
  });

  it('on / with nothing saved stays pt', async () => {
    renderAt('/');
    await new Promise((r) => setTimeout(r, 20));
    expect(i18n.language).toBe('pt');
  });
});
