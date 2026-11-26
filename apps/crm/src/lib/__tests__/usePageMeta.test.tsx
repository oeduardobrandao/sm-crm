import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'vitest';
import { usePageMeta } from '../usePageMeta';

const alternates = () =>
  Array.from(
    document.head.querySelectorAll<HTMLLinkElement>('link[rel="alternate"][hreflang]'),
  ).map((l) => [l.getAttribute('hreflang'), l.getAttribute('href')]);
const ogLocale = () =>
  document.head.querySelector('meta[property="og:locale"]')?.getAttribute('content');

afterEach(() => {
  document.head.innerHTML = '';
});

describe('usePageMeta locale and hreflang', () => {
  test('/en sets og:locale and the alternates; /lgpd removes them', () => {
    const { rerender } = renderHook(({ path }) => usePageMeta(path), {
      initialProps: { path: '/en' },
    });
    expect(ogLocale()).toBe('en_US');
    expect(alternates()).toEqual([
      ['en', 'https://www.mesaas.com.br/en'],
      ['pt-BR', 'https://www.mesaas.com.br/'],
      ['x-default', 'https://www.mesaas.com.br/'],
    ]);

    rerender({ path: '/lgpd' });
    expect(ogLocale()).toBe('pt_BR');
    expect(alternates()).toEqual([]);
  });

  test('does not duplicate alternates on repeated navigation', () => {
    const { rerender } = renderHook(({ path }) => usePageMeta(path), {
      initialProps: { path: '/' },
    });
    rerender({ path: '/en' });
    rerender({ path: '/' });
    expect(alternates()).toHaveLength(3);
  });
});
