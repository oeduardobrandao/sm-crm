import { describe, expect, it, vi } from 'vitest';
import { openExternalUrl, sanitizeExternalUrl, sanitizeUrl } from '../security';

const unsafeExternalUrls = [
  'javascript:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  '//evil.example/path',
  'https://user:password@example.com/private',
  'not a url',
];

describe('CRM URL security', () => {
  it.each(unsafeExternalUrls)('blocks unsafe external URL %s', (value) => {
    expect(sanitizeExternalUrl(value)).toBe('#');
  });

  it('allows credential-free HTTP(S) and safe relative app URLs', () => {
    expect(sanitizeExternalUrl(' https://example.com/a?q=1 ')).toBe('https://example.com/a?q=1');
    expect(sanitizeExternalUrl('example.com/a?q=1')).toBe('https://example.com/a?q=1');
    expect(sanitizeUrl('/clientes/42')).toBe('/clientes/42');
    expect(sanitizeUrl('./clientes/42')).toBe('./clientes/42');
    expect(sanitizeUrl('#detalhes')).toBe('#detalhes');
    expect(sanitizeUrl('//evil.example')).toBe('#');
  });

  it('opens only sanitized external URLs in an isolated tab', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);

    expect(openExternalUrl('javascript:alert(1)')).toBeNull();
    expect(open).not.toHaveBeenCalled();

    openExternalUrl('https://example.com/file');
    expect(open).toHaveBeenCalledWith(
      'https://example.com/file',
      '_blank',
      'noopener,noreferrer',
    );
  });
});
