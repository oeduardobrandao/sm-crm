import { describe, expect, it } from 'vitest';
import { buildHubPostLink } from '../hubLinks';

describe('buildHubPostLink', () => {
  it('appends the postagens path to a relative base', () => {
    expect(buildHubPostLink('/mesaas/hub/tok', 42)).toBe('/mesaas/hub/tok/postagens/42');
  });
  it('works with an absolute base', () => {
    expect(buildHubPostLink('https://app.mesaas.com.br/mesaas/hub/tok', 7)).toBe(
      'https://app.mesaas.com.br/mesaas/hub/tok/postagens/7',
    );
  });
  it('trims a single trailing slash on the base', () => {
    expect(buildHubPostLink('/mesaas/hub/tok/', 9)).toBe('/mesaas/hub/tok/postagens/9');
  });
});
