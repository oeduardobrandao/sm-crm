import { describe, expect, it } from 'vitest';
import { buildHubPostLink, compactHubToken } from '@/lib/hubLinks';

describe('buildHubPostLink (crm)', () => {
  it('appends the postagens path', () => {
    expect(buildHubPostLink('https://app.mesaas.com.br/acme/hub/tok', 12)).toBe(
      'https://app.mesaas.com.br/acme/hub/tok/postagens/12',
    );
  });
  it('trims a trailing slash', () => {
    expect(buildHubPostLink('https://x/acme/hub/tok/', 3)).toBe(
      'https://x/acme/hub/tok/postagens/3',
    );
  });
});

describe('compactHubToken (crm)', () => {
  it('drops the hyphens from a UUID', () => {
    expect(compactHubToken('b6a359fb-af56-470a-8f0a-7e215a67b9b9')).toBe(
      'b6a359fbaf56470a8f0a7e215a67b9b9',
    );
  });
  it('leaves a non-UUID token alone', () => {
    expect(compactHubToken('tok-1')).toBe('tok-1');
  });
});
