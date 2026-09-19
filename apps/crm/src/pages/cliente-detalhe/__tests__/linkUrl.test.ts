import { describe, it, expect } from 'vitest';
import { normalizeLinkUrl, linkDomain } from '../linkUrl';

describe('normalizeLinkUrl', () => {
  it('keeps a valid https url as typed', () => {
    expect(normalizeLinkUrl('https://drive.google.com/drive/folders/abc')).toBe(
      'https://drive.google.com/drive/folders/abc',
    );
  });

  it('keeps http', () => {
    expect(normalizeLinkUrl('http://exemplo.com.br')).toBe('http://exemplo.com.br');
  });

  it('prepends https:// when there is no scheme', () => {
    expect(normalizeLinkUrl('drive.google.com/x')).toBe('https://drive.google.com/x');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeLinkUrl('  notion.so/aurora  ')).toBe('https://notion.so/aurora');
  });

  it('caps the normalized url at 2048 characters', () => {
    const atLimit = `https://exemplo.com/${'a'.repeat(2048 - 'https://exemplo.com/'.length)}`;
    expect(normalizeLinkUrl(atLimit)).toBe(atLimit);
    expect(normalizeLinkUrl(`${atLimit}a`)).toBeNull();
    // Scheme-less: the prepended https:// counts toward the limit.
    const bare = atLimit.slice('https://'.length);
    expect(normalizeLinkUrl(bare)).toBe(atLimit);
    expect(normalizeLinkUrl(`${bare}a`)).toBeNull();
  });

  it.each([
    '',
    '   ',
    'javascript:alert(1)',
    'data:text/html,<b>x</b>',
    'ftp://exemplo.com',
    '//exemplo.com',
    'https://user:pass@exemplo.com',
    'localhost',
    'não é url',
    'https://exemplo.com/a b',
  ])('rejects %j', (raw) => {
    expect(normalizeLinkUrl(raw)).toBeNull();
  });
});

describe('linkDomain', () => {
  it('returns the hostname without www', () => {
    expect(linkDomain('https://www.figma.com/file/1')).toBe('figma.com');
  });

  it('falls back to the raw value when it is not parseable', () => {
    expect(linkDomain('???')).toBe('???');
  });
});
