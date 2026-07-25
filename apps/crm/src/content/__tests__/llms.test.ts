import { describe, expect, test } from 'vitest';
import { buildLlmsTxt } from '../llms';
import { PUBLIC_ROUTES } from '../site-meta';

describe('buildLlmsTxt', () => {
  const txt = buildLlmsTxt(PUBLIC_ROUTES);
  test('opens with the brand block and lists every page', () => {
    expect(txt.startsWith('# Mesaas')).toBe(true);
    expect(txt).toContain('> CRM para agências e gestores de social media');
    for (const r of PUBLIC_ROUTES) {
      expect(txt).toContain(`](https://www.mesaas.com.br${r.path === '/' ? '/' : r.path})`);
    }
  });
});
