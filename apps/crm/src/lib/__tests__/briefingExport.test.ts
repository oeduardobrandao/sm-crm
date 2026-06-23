import { describe, expect, it } from 'vitest';

import { escapeMarkdown, slugifyTitle } from '../briefingExport';

describe('escapeMarkdown', () => {
  it('escapes inline metacharacters', () => {
    expect(escapeMarkdown('a *b* _c_ `d` [e] <f>')).toBe('a \\*b\\* \\_c\\_ \\`d\\` \\[e\\] \\<f>');
  });

  it('escapes a leading heading marker', () => {
    expect(escapeMarkdown('## not a heading')).toBe('\\## not a heading');
  });

  it('escapes a leading list/quote/pipe marker', () => {
    expect(escapeMarkdown('- item')).toBe('\\- item');
    expect(escapeMarkdown('> quote')).toBe('\\> quote');
    expect(escapeMarkdown('| a | b |')).toBe('\\| a | b |'); // only the leading marker is escaped
  });

  it('escapes an ordered-list marker on the punctuation', () => {
    expect(escapeMarkdown('1. first')).toBe('1\\. first');
  });

  it('leaves ordinary prose punctuation untouched', () => {
    expect(escapeMarkdown('Olá, tudo bem? (sim!)')).toBe('Olá, tudo bem? (sim!)');
  });

  it('handles each line of multi-line text', () => {
    expect(escapeMarkdown('first\n# second')).toBe('first\n\\# second');
  });
});

describe('slugifyTitle', () => {
  it('strips accents and lowercases', () => {
    expect(slugifyTitle('Visão & Storytelling')).toBe('visao-storytelling');
  });

  it('collapses separators and trims dashes', () => {
    expect(slugifyTitle('  Briefing -- 2026!  ')).toBe('briefing-2026');
  });

  it('falls back to "briefing" when empty', () => {
    expect(slugifyTitle('   ')).toBe('briefing');
    expect(slugifyTitle('!!!')).toBe('briefing');
  });
});
