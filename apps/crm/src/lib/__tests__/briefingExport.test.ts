import { describe, expect, it } from 'vitest';

import { buildBriefingExportSections, briefingToCSV, briefingToMarkdown, escapeMarkdown, slugifyTitle } from '../briefingExport';
import { parseCSV } from '../csv';
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

describe('briefingToCSV', () => {
  it('emits header and one row per question in section order', () => {
    const csv = briefingToCSV([
      { name: '', questions: [{ question: 'Nome?', answer: 'Ana' }] },
      { name: 'DADOS', questions: [{ question: 'Idade?', answer: null }] },
    ]);
    expect(csv).toBe('pergunta,secao,resposta\nNome?,,Ana\nIdade?,DADOS,');
  });

  it('quotes fields containing commas or quotes and doubles internal quotes', () => {
    const csv = briefingToCSV([
      { name: '', questions: [{ question: 'Cores?', answer: 'azul, verde' }] },
      { name: '', questions: [{ question: 'Apelido?', answer: 'diz "oi"' }] },
    ]);
    const lines = csv.split('\n');
    expect(lines[1]).toBe('Cores?,,"azul, verde"');
    expect(lines[2]).toBe('Apelido?,,"diz ""oi"""');
  });

  it('flattens newlines inside a value to a single space', () => {
    const csv = briefingToCSV([
      { name: '', questions: [{ question: 'Bio?', answer: 'linha1\nlinha2' }] },
    ]);
    expect(csv.split('\n')[1]).toBe('Bio?,,linha1 linha2');
  });

  it('round-trips through parseCSV for quote-free, newline-free values', () => {
    const sections = [
      { name: '', questions: [{ question: 'Nome?', answer: 'Ana' }] },
      { name: 'DADOS', questions: [{ question: 'Cidade?', answer: 'São Paulo, SP' }] },
    ];
    const parsed = parseCSV(briefingToCSV(sections));
    expect(parsed).toEqual([
      { pergunta: 'Nome?', secao: '', resposta: 'Ana' },
      { pergunta: 'Cidade?', secao: 'DADOS', resposta: 'São Paulo, SP' },
    ]);
  });
});

describe('briefingToMarkdown', () => {
  it('renders title H1, unsectioned-first, headings, and blank-answer marker', () => {
    const md = briefingToMarkdown('Briefing Ana', [
      { name: '', questions: [{ question: 'Nome?', answer: 'Ana' }] },
      { name: 'DADOS', questions: [{ question: 'Idade?', answer: null }] },
    ]);
    expect(md).toBe(
      '# Briefing — Briefing Ana\n\n' +
        '**Nome?**\nAna\n\n' +
        '## DADOS\n\n' +
        '**Idade?**\n_(sem resposta)_\n',
    );
  });

  it('omits the title suffix when title is blank', () => {
    expect(briefingToMarkdown('  ', [{ name: '', questions: [{ question: 'Q?', answer: 'A' }] }])).toBe(
      '# Briefing\n\n**Q?**\nA\n',
    );
  });

  it('escapes metacharacters in questions and answers', () => {
    const md = briefingToMarkdown('T', [
      { name: '', questions: [{ question: '# heading?', answer: 'use *bold*' }] },
    ]);
    expect(md).toContain('**\\# heading?**');
    expect(md).toContain('use \\*bold\\*');
  });

  it('escapes metacharacters in the title and section name', () => {
    expect(
      briefingToMarkdown('Plano *2025*', [
        { name: 'A * B', questions: [{ question: 'Q?', answer: 'A' }] },
      ]),
    ).toBe('# Briefing — Plano \\*2025\\*\n\n## A \\* B\n\n**Q?**\nA\n');
  });
});
