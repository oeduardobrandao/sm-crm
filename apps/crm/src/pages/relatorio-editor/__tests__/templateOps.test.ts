import { describe, expect, it } from 'vitest';
import type { ReportLayout } from '@mesaas/report-blocks/types';
import { applyTemplateLayout, stripAiTextForTemplate } from '../templateOps';

const doc = (label: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: label }] }],
});

describe('stripAiTextForTemplate', () => {
  it('remove text dos blocos ai_ e preserva blocos text, config e accent', () => {
    const layout: ReportLayout = {
      version: 1,
      accent: '#9f1239',
      blocks: [
        { id: 't1', type: 'text', size: 'full', text: doc('autor') },
        { id: 's1', type: 'ai_summary', size: 'full', text: doc('ia') },
        { id: 'p1', type: 'top_posts', size: 'full', config: { count: 6 } },
      ],
    };
    const out = stripAiTextForTemplate(layout);
    expect(out.accent).toBe('#9f1239');
    expect(out.blocks[0].text).toEqual(doc('autor'));
    expect(out.blocks[1].text).toBeUndefined();
    expect(out.blocks[1].id).toBe('s1');
    expect(out.blocks[2].config).toEqual({ count: 6 });
    // imutável: entrada intacta
    expect(layout.blocks[1].text).toEqual(doc('ia'));
  });

  it('stripAiTextForTemplate preserva theme, fonts e accent (aparencia e parte do template)', () => {
    const layout: ReportLayout = {
      version: 1,
      accent: '#7c3aed',
      theme: 'editorial',
      fonts: 'fraunces',
      blocks: [{ id: 'a', type: 'ai_summary', size: 'full', text: { type: 'doc', content: [] } }],
    };
    const stripped = stripAiTextForTemplate(layout);
    expect(stripped.theme).toBe('editorial');
    expect(stripped.fonts).toBe('fraunces');
    expect(stripped.accent).toBe('#7c3aed');
  });
});

describe('applyTemplateLayout', () => {
  const current: ReportLayout = {
    version: 1,
    blocks: [
      { id: 'cs', type: 'ai_summary', size: 'full', text: doc('resumo atual') },
      { id: 'cg', type: 'ai_goals', size: 'full', text: doc('metas atuais') },
    ],
  };

  it('substitui o layout inteiro e herda texto de IA do mesmo tipo', () => {
    const template: ReportLayout = {
      version: 1,
      accent: '#123456',
      blocks: [
        { id: 'tc', type: 'cover', size: 'full' },
        { id: 'ts', type: 'ai_summary', size: 'half' },
      ],
    };
    const out = applyTemplateLayout(template, current);
    expect(out.accent).toBe('#123456');
    expect(out.blocks.map((b) => b.id)).toEqual(['tc', 'ts']);
    expect(out.blocks[1].text).toEqual(doc('resumo atual'));
    expect(out.blocks[1].size).toBe('half');
  });

  it('bloco de IA sem correspondente com texto no atual é removido', () => {
    const template: ReportLayout = {
      version: 1,
      blocks: [
        { id: 'tr', type: 'ai_recommendations', size: 'full' },
        { id: 'tg', type: 'ai_goals', size: 'full' },
      ],
    };
    const out = applyTemplateLayout(template, current);
    expect(out.blocks.map((b) => b.id)).toEqual(['tg']);
    expect(out.blocks[0].text).toEqual(doc('metas atuais'));
  });

  it('template sem accent remove o accent atual (substituição completa)', () => {
    const template: ReportLayout = {
      version: 1,
      blocks: [{ id: 'x', type: 'divider', size: 'full' }],
    };
    const out = applyTemplateLayout(template, { ...current, accent: '#ff0000' });
    expect(out.accent).toBeUndefined();
  });

  it('aplica template com theme e fonts, preservando ambos', () => {
    const template: ReportLayout = {
      version: 1,
      theme: 'editorial',
      fonts: 'fraunces',
      blocks: [{ id: 'x', type: 'divider', size: 'full' }],
    };
    const out = applyTemplateLayout(template, current);
    expect(out.theme).toBe('editorial');
    expect(out.fonts).toBe('fraunces');
  });
});
