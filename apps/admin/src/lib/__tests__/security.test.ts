import { describe, expect, it } from 'vitest';
import { sanitizeExternalUrl } from '../security';

describe('Admin URL security', () => {
  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    '//evil.example/path',
    'https://user:password@example.com/private',
    'not a url',
    'nota',
  ])('blocks unsafe external URL %s', (value) => {
    expect(sanitizeExternalUrl(value)).toBe('#');
  });

  it('allows credential-free HTTP(S)', () => {
    expect(sanitizeExternalUrl('https://example.com/a?q=1')).toBe('https://example.com/a?q=1');
    expect(sanitizeExternalUrl('example.com/a?q=1')).toBe('https://example.com/a?q=1');
  });
});
