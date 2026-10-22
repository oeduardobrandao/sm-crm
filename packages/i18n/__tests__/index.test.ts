import i18next from 'i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSavedLanguage, initI18n, loadLazyNamespaces, STORAGE_KEY } from '../index';

// i18next keeps the resources object it is given and adds fetched bundles into it, so every
// test gets a fresh copy.
const bundled = () => ({
  pt: { common: { hello: 'Olá' } },
  en: { common: { hello: 'Hello' } },
});

const lazyBundles: Record<string, Record<string, Record<string, unknown>>> = {
  pt: { posts: { title: 'Postagens' }, leads: { title: 'Leads pt' } },
  en: { posts: { title: 'Posts' }, leads: { title: 'Leads en' } },
};

function setup() {
  const instance = i18next.createInstance();
  const load = vi.fn(async (lng: string, ns: string) => lazyBundles[lng][ns]);
  initI18n(bundled(), { instance, lazy: { namespaces: ['posts', 'leads'], load } });
  return { instance, load };
}

describe('initI18n with lazy namespaces', () => {
  afterEach(() => localStorage.clear());

  it('initialises synchronously with the bundled namespaces, fetching nothing', () => {
    const { instance, load } = setup();

    expect(instance.isInitialized).toBe(true);
    expect(instance.t('hello')).toBe('Olá');
    expect(instance.hasLoadedNamespace('common')).toBe(true);
    expect(load).not.toHaveBeenCalled();
  });

  it('stays synchronous for a visitor whose saved language is English', () => {
    localStorage.setItem(STORAGE_KEY, 'en');
    const { instance, load } = setup();

    expect(instance.isInitialized).toBe(true);
    expect(instance.t('hello')).toBe('Hello');
    expect(load).not.toHaveBeenCalled();
  });

  it('loadLazyNamespaces fetches every lazy namespace for the language and its fallback', async () => {
    localStorage.setItem(STORAGE_KEY, 'en');
    const { instance, load } = setup();

    await loadLazyNamespaces(instance);

    expect(load.mock.calls.map(([lng, ns]) => `${lng}/${ns}`).sort()).toEqual([
      'en/leads',
      'en/posts',
      'pt/leads',
      'pt/posts',
    ]);
    expect(instance.t('posts:title')).toBe('Posts');
  });

  it('changeLanguage fetches the new language for already-loaded lazy namespaces first', async () => {
    const { instance, load } = setup();
    await loadLazyNamespaces(instance);
    expect(instance.t('posts:title')).toBe('Postagens');
    load.mockClear();

    await instance.changeLanguage('en');

    expect(load.mock.calls.map(([lng, ns]) => `${lng}/${ns}`).sort()).toEqual([
      'en/leads',
      'en/posts',
    ]);
    expect(instance.t('posts:title')).toBe('Posts');
    expect(instance.t('hello')).toBe('Hello');
  });

  it('a failed bundle does not reject the preload', async () => {
    const instance = i18next.createInstance();
    const load = vi.fn(async () => {
      throw new Error('chunk 404');
    });
    initI18n(bundled(), {
      instance,
      lazy: { namespaces: ['posts'], load },
    });

    await expect(loadLazyNamespaces(instance)).resolves.toBeUndefined();
    expect(instance.t('posts:title')).toBe('title');
  });

  it('resolves immediately when nothing was configured as lazy', async () => {
    const instance = i18next.createInstance();
    initI18n(bundled(), { instance });

    await expect(loadLazyNamespaces(instance)).resolves.toBeUndefined();
    expect(instance.isInitialized).toBe(true);
  });
});

describe('server-safe boot', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('getSavedLanguage is pt and initI18n does not throw when localStorage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new Error('denied');
      },
    });
    expect(getSavedLanguage()).toBe('pt');
    const instance = i18next.createInstance();
    expect(() => initI18n(bundled(), { instance })).not.toThrow();
    expect(instance.language).toBe('pt');
  });

  it('getSavedLanguage is pt when localStorage is undefined', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(getSavedLanguage()).toBe('pt');
  });

  it('initialLanguage wins for init without touching the stored language', () => {
    localStorage.setItem(STORAGE_KEY, 'en');
    const instance = i18next.createInstance();
    initI18n(bundled(), { instance, initialLanguage: 'pt' });
    expect(instance.language).toBe('pt');
    expect(localStorage.getItem(STORAGE_KEY)).toBe('en');
  });
});
