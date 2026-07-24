import { describe, expect, test } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePageMeta } from '../usePageMeta';

describe('usePageMeta', () => {
  test('sets title, description, canonical, OG and Twitter tags', () => {
    renderHook(() => usePageMeta('/precos'));
    expect(document.title).toBe('Preços do Mesaas — planos para agências de social media');
    expect(
      document.head.querySelector('meta[name="description"]')?.getAttribute('content'),
    ).toContain('Compare os planos');
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      'https://www.mesaas.com.br/precos',
    );
    expect(document.head.querySelector('meta[name="twitter:image"]')?.getAttribute('content')).toBe(
      'https://www.mesaas.com.br/og-image.png',
    );
  });

  test('navigating to another route leaves no stale tags', () => {
    const { rerender } = renderHook(({ p }: { p: string }) => usePageMeta(p), {
      initialProps: { p: '/precos' },
    });
    rerender({ p: '/sobre' });
    expect(document.title).toBe('Sobre o Mesaas — quem constrói o CRM para social media');
    expect(document.head.querySelector('meta[name="twitter:title"]')?.getAttribute('content')).toBe(
      'Sobre o Mesaas — quem constrói o CRM para social media',
    );
    expect(document.head.querySelectorAll('meta[name="description"]')).toHaveLength(1);
    expect(document.head.querySelectorAll('link[rel="canonical"]')).toHaveLength(1);
  });

  test('is a no-op for unknown paths', () => {
    document.title = 'unchanged';
    renderHook(() => usePageMeta('/dashboard'));
    expect(document.title).toBe('unchanged');
  });
});
