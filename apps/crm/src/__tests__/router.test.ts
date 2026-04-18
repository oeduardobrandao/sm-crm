import { describe, expect, it } from 'vitest';

import { escapeHTML, sanitizeUrl } from '../router';

describe('router security helpers', () => {
  it('escapes raw HTML entities before interpolation', () => {
    expect(escapeHTML(`<img src=x onerror="alert('oi')">&`)).toBe(
      '&lt;img src=x onerror=&quot;alert(&#39;oi&#39;)&quot;&gt;&amp;',
    );
  });

  it.each([
    ['https://mesaas.com.br/clientes/joao', 'https://mesaas.com.br/clientes/joao'],
    ['  http://localhost:5173/clientes/12  ', 'http://localhost:5173/clientes/12'],
    ['/clientes/42', '/clientes/42'],
    ['./briefing', './briefing'],
    ['../marca', '../marca'],
    ['#secao-feedback', '#secao-feedback'],
  ])('allows safe router URL %s', (value, expected) => {
    expect(sanitizeUrl(value)).toBe(expected);
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'ftp://servidor.inseguro',
    '//evil.com/phishing',
    '  ',
    'nota solta',
  ])('blocks unsafe router URL %s', (value) => {
    expect(sanitizeUrl(value)).toBe('#');
  });
});
