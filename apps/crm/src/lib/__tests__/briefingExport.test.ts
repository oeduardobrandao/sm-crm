import { describe, expect, it } from 'vitest';

import { buildBriefingExportSections, escapeMarkdown, slugifyTitle } from '../briefingExport';
import type { HubBriefingQuestionRow } from '@/store/hub';

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

function q(partial: Partial<HubBriefingQuestionRow>): HubBriefingQuestionRow {
  return {
    id: partial.id ?? 'id',
    cliente_id: 1,
    conta_id: 'c',
    briefing_id: partial.briefing_id ?? 'b1',
    question: partial.question ?? 'Q',
    answer: partial.answer ?? null,
    section: partial.section ?? null,
    display_order: partial.display_order ?? 0,
    created_at: '2026-01-01',
  };
}

describe('buildBriefingExportSections', () => {
  it("returns only the selected briefing's questions", () => {
    const rows = [
      q({ id: '1', briefing_id: 'b1', question: 'keep' }),
      q({ id: '2', briefing_id: 'b2', question: 'drop' }),
    ];
    const sections = buildBriefingExportSections(rows, 'b1', 'b1');
    const questions = sections.flatMap((s) => s.questions.map((x) => x.question));
    expect(questions).toEqual(['keep']);
  });

  it('treats null briefing_id as the first briefing', () => {
    const rows = [q({ id: '1', briefing_id: null, question: 'orphan' })];
    const sections = buildBriefingExportSections(rows, 'b1', 'b1');
    expect(sections.flatMap((s) => s.questions.map((x) => x.question))).toEqual(['orphan']);
  });

  it("orders the unsectioned bucket first, then named sections first-seen", () => {
    const rows = [
      q({ id: '1', section: 'DADOS', question: 'a' }),
      q({ id: '2', section: null, question: 'b' }),
      q({ id: '3', section: 'AUDIÊNCIA', question: 'c' }),
      q({ id: '4', section: 'DADOS', question: 'd' }),
    ];
    const sections = buildBriefingExportSections(rows, 'b1', 'b1');
    expect(sections.map((s) => s.name)).toEqual(['', 'DADOS', 'AUDIÊNCIA']);
    expect(sections[1].questions.map((x) => x.question)).toEqual(['a', 'd']);
  });
});
