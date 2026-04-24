import { describe, it, expect } from 'vitest';
import { buildSrcSet, buildFormatSource } from '../components/OptimizedImage';

const PROXY_URL = 'https://media.example.com/contas/1/posts/2/img.jpg?exp=9999999999&sig=abc123';
const PLAIN_URL = 'https://cdn.example.com/photo.jpg';

describe('buildSrcSet', () => {
  it('generates srcSet for proxy URLs', () => {
    const result = buildSrcSet(PROXY_URL, [400, 800, 1200]);
    expect(result).toContain('&w=400 400w');
    expect(result).toContain('&w=800 800w');
    expect(result).toContain('&w=1200 1200w');
  });

  it('returns empty string for non-proxy URLs', () => {
    expect(buildSrcSet(PLAIN_URL, [400, 800])).toBe('');
  });

  it('filters widths larger than source and adds source as max', () => {
    const result = buildSrcSet(PROXY_URL, [400, 800, 1200, 1600], 1000);
    expect(result).toContain('400w');
    expect(result).toContain('800w');
    expect(result).toContain('1000w');
    expect(result).not.toContain('1200w');
    expect(result).not.toContain('1600w');
  });

  it('includes source width as the largest breakpoint', () => {
    const result = buildSrcSet(PROXY_URL, [400, 800], 600);
    expect(result).toContain('400w');
    expect(result).toContain('600w');
    expect(result).not.toContain('800w');
  });

  it('returns empty string when no widths are applicable', () => {
    const result = buildSrcSet(PROXY_URL, [800, 1200], 300);
    expect(result).toContain('300w');
  });
});

describe('buildFormatSource', () => {
  it('generates format-specific srcSet for avif', () => {
    const result = buildFormatSource(PROXY_URL, 'avif', [400, 800]);
    expect(result).toContain('&w=400&f=avif 400w');
    expect(result).toContain('&w=800&f=avif 800w');
  });

  it('generates format-specific srcSet for webp', () => {
    const result = buildFormatSource(PROXY_URL, 'webp', [400]);
    expect(result).toContain('&w=400&f=webp 400w');
  });

  it('returns empty string for non-proxy URLs', () => {
    expect(buildFormatSource(PLAIN_URL, 'avif', [400])).toBe('');
  });

  it('respects source width limit', () => {
    const result = buildFormatSource(PROXY_URL, 'webp', [400, 800, 1200], 500);
    expect(result).toContain('400w');
    expect(result).toContain('500w');
    expect(result).not.toContain('800w');
  });
});
