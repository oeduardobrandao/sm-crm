import { describe, expect, it } from 'vitest';
import { buildHubPostLink } from '@/lib/hubLinks';

describe('buildHubPostLink (crm)', () => {
  it('appends the postagens path', () => {
    expect(buildHubPostLink('https://app.mesaas.com.br/acme/hub/tok', 12)).toBe(
      'https://app.mesaas.com.br/acme/hub/tok/postagens/12',
    );
  });
  it('trims a trailing slash', () => {
    expect(buildHubPostLink('https://x/acme/hub/tok/', 3)).toBe('https://x/acme/hub/tok/postagens/3');
  });
});
