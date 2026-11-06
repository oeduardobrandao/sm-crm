import { describe, expect, it } from 'vitest';
import { validateLayout, type ReportLayout } from '@mesaas/report-blocks/types';
import {
  applyTemplateLayout,
  layoutHasFilledImage,
  sanitizeLayoutForTemplate,
} from '../templateOps';

const doc = (label: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: label }] }],
});

describe('sanitizeLayoutForTemplate', () => {
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
    const out = sanitizeLayoutForTemplate(layout);
    expect(out.accent).toBe('#9f1239');
    expect(out.blocks[0].text).toEqual(doc('autor'));
    expect(out.blocks[1].text).toBeUndefined();
    expect(out.blocks[1].id).toBe('s1');
    expect(out.blocks[2].config).toEqual({ count: 6 });
    // imutável: entrada intacta
    expect(layout.blocks[1].text).toEqual(doc('ia'));
  });

  it('sanitizeLayoutForTemplate preserva theme, fonts e accent (aparencia e parte do template)', () => {
    const layout: ReportLayout = {
      version: 1,
      accent: '#7c3aed',
      theme: 'editorial',
      fonts: 'fraunces',
      blocks: [{ id: 'a', type: 'ai_summary', size: 'full', text: { type: 'doc', content: [] } }],
    };
    const stripped = sanitizeLayoutForTemplate(layout);
    expect(stripped.theme).toBe('editorial');
    expect(stripped.fonts).toBe('fraunces');
    expect(stripped.accent).toBe('#7c3aed');
  });
});

// Blocos de conteúdo (sem os marcadores de seção que o apply acrescenta).
const contentIds = (l: ReportLayout) =>
  l.blocks.filter((b) => b.type !== 'section').map((b) => b.id);

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
    expect(contentIds(out)).toEqual(['tc', 'ts']);
    const ts = out.blocks.find((b) => b.id === 'ts')!;
    expect(ts.text).toEqual(doc('resumo atual'));
    expect(ts.size).toBe('half');
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
    expect(contentIds(out)).toEqual(['tg']);
    expect(out.blocks.find((b) => b.id === 'tg')!.text).toEqual(doc('metas atuais'));
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

  it('modelo legado sai seccionado e válido', () => {
    const template: ReportLayout = {
      version: 1,
      blocks: [
        { id: 'tc', type: 'cover', size: 'full' },
        { id: 'tr', type: 'kpi_reach', size: 'third' },
        { id: 'ts', type: 'ai_summary', size: 'full' },
      ],
    };
    const out = applyTemplateLayout(template, current);
    expect(out.blocks[0].type).toBe('section');
    // Sem section_header no topo, a capa antes do primeiro bloco do Instagram vira Geral; o resto
    // é uma seção Instagram de título oculto (spec §Reading).
    expect(out.blocks.map((b) => b.type)).toEqual([
      'section',
      'cover',
      'section',
      'kpi_reach',
      'ai_summary',
    ]);
    expect(out.blocks[0].config).toBeUndefined();
    expect(out.blocks[2].config).toEqual({ platform: 'instagram', hideHeader: true });
    expect(validateLayout(out)).toMatchObject({ ok: true });
  });

  it('modelo seccionado mantém as seções como estão, inclusive a de TikTok', () => {
    const template: ReportLayout = {
      version: 1,
      blocks: [
        { id: 'g', type: 'section', size: 'full' },
        { id: 'tg', type: 'ai_goals', size: 'full' },
        { id: 'tt', type: 'section', size: 'full', config: { platform: 'tiktok' } },
        { id: 'tk', type: 'tiktok_kpi_views', size: 'third' },
      ],
    };
    const out = applyTemplateLayout(template, current);
    expect(out.blocks.map((b) => b.id)).toEqual(['g', 'tg', 'tt', 'tk']);
    expect(out.blocks[0]).toBe(template.blocks[0]);
    expect(validateLayout(out)).toMatchObject({ ok: true });
  });

  it('IA sem correspondente sai sem quebrar a seção (seção vazia continua)', () => {
    const template: ReportLayout = {
      version: 1,
      blocks: [
        { id: 'g', type: 'section', size: 'full' },
        { id: 'tr', type: 'ai_recommendations', size: 'full' },
      ],
    };
    const out = applyTemplateLayout(template, current);
    expect(out.blocks.map((b) => b.id)).toEqual(['g']);
    expect(validateLayout(out)).toMatchObject({ ok: true });
  });
});

describe('layoutHasFilledImage', () => {
  it('só conta imagem com file_id', () => {
    expect(
      layoutHasFilledImage({ version: 1, blocks: [{ id: 'i', type: 'image', size: 'full' }] }),
    ).toBe(false);
    expect(
      layoutHasFilledImage({
        version: 1,
        blocks: [
          { id: 'i', type: 'image', size: 'full', config: { file_id: 1, width: 1, height: 1 } },
        ],
      }),
    ).toBe(true);
  });
});
