import { describe, expect, it } from 'vitest';

import { sanitizeUrl } from '../utils/security';

describe('utils/security sanitizeUrl', () => {
  it.each([
    ['https://mesaas.com.br/hub/token-seguro', 'https://mesaas.com.br/hub/token-seguro'],
    ['http://localhost:5175/cliente/ana', 'http://localhost:5175/cliente/ana'],
    ['/uploads/briefing.pdf', '/uploads/briefing.pdf'],
    ['./marca/manual.pdf', './marca/manual.pdf'],
    ['../paginas/guia', '../paginas/guia'],
    ['#comentarios', '#comentarios'],
  ])('preserves allowed URL %s', (value, expected) => {
    expect(sanitizeUrl(value)).toBe(expected);
  });

  it.each([
    undefined,
    null,
    '',
    'javascript:fetch("https://evil.test")',
    'data:text/html;base64,abc',
    '//malicioso.example',
    'file:///etc/passwd',
  ])('normalizes unsafe URL %s to a harmless placeholder', (value) => {
    expect(sanitizeUrl(value)).toBe('#');
  });
});
