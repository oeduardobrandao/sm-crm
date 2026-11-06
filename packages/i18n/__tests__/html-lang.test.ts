import { afterEach, describe, expect, it, vi } from 'vitest';
import { changeLanguage, htmlLangFor, i18n, initI18n, STORAGE_KEY } from '../index';

const resources = {
  pt: { common: { hello: 'Olá' } },
  en: { common: { hello: 'Hello' } },
};

describe('<html lang> follows the UI language', () => {
  afterEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    document.documentElement.lang = '';
  });

  it('maps languages to BCP 47 tags', () => {
    expect(htmlLangFor('pt')).toBe('pt-BR');
    expect(htmlLangFor('en')).toBe('en');
    expect(htmlLangFor('en-US')).toBe('en');
  });

  it('sets the saved language at init', async () => {
    localStorage.setItem(STORAGE_KEY, 'en');
    initI18n(resources);
    await vi.waitFor(() => expect(document.documentElement.lang).toBe('en'));
  });

  it('updates on switch', async () => {
    initI18n(resources);
    changeLanguage('en');
    expect(document.documentElement.lang).toBe('en');
    changeLanguage('pt');
    expect(document.documentElement.lang).toBe('pt-BR');
    expect(i18n.t('hello')).toBe('Olá');
  });
});
