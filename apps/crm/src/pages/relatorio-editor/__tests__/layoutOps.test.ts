import { describe, expect, it } from 'vitest';
import {
  insertBlock,
  moveBlock,
  removeBlock,
  resizeBlock,
  setLayoutAccent,
  SIZE_ORDER,
  updateBlockText,
} from '../layoutOps';
import { validateLayout, type ReportLayout } from '@mesaas/report-blocks/types';

const layout = (): ReportLayout => ({
  version: 1,
  blocks: [
    { id: 'a', type: 'cover', size: 'full' },
    { id: 'b', type: 'kpi_reach', size: 'third' },
    { id: 'c', type: 'text', size: 'full', text: { type: 'doc', content: [] } },
  ],
});

describe('moveBlock', () => {
  it('move a antes de c quando arrastado sobre c', () => {
    const next = moveBlock(layout(), 'a', 'c');
    expect(next.blocks.map((b) => b.id)).toEqual(['b', 'c', 'a']);
  });
  it('id inexistente: retorna a MESMA referência', () => {
    const l = layout();
    expect(moveBlock(l, 'zzz', 'a')).toBe(l);
  });
  it('não muta o original', () => {
    const l = layout();
    moveBlock(l, 'a', 'c');
    expect(l.blocks[0].id).toBe('a');
  });
});

describe('resizeBlock', () => {
  it('third +1 vira half; half +1 vira full; full satura', () => {
    let l = resizeBlock(layout(), 'b', 1);
    expect(l.blocks[1].size).toBe('half');
    l = resizeBlock(l, 'b', 1);
    expect(l.blocks[1].size).toBe('full');
    expect(resizeBlock(l, 'b', 1).blocks[1].size).toBe('full');
  });
  it('third -1 satura em third', () => {
    expect(resizeBlock(layout(), 'b', -1).blocks[1].size).toBe('third');
  });
});

describe('removeBlock', () => {
  it('remove pelo id', () => {
    expect(removeBlock(layout(), 'b').blocks.map((b) => b.id)).toEqual(['a', 'c']);
  });
});

describe('insertBlock', () => {
  it('insere no fim com defaults por tipo e id novo', () => {
    let n = 0;
    const { layout: next, newId } = insertBlock(layout(), 'top_posts', () => `n${++n}`);
    const added = next.blocks[next.blocks.length - 1];
    expect(newId).toBe('n1');
    expect(added).toEqual({ id: 'n1', type: 'top_posts', size: 'full', config: { count: 6 } });
  });
  it('kpi entra como third; texto entra como full com doc vazio', () => {
    const kpi = insertBlock(layout(), 'kpi_saves', () => 'k').layout.blocks.at(-1)!;
    expect(kpi.size).toBe('third');
    const txt = insertBlock(layout(), 'text', () => 't').layout.blocks.at(-1)!;
    expect(txt.size).toBe('full');
    expect(txt.text).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [] }] });
  });
  it('section_header entra com config.title vazio editável', () => {
    const sh = insertBlock(layout(), 'section_header', () => 's').layout.blocks.at(-1)!;
    expect(sh.config).toEqual({ title: 'Nova seção' });
  });
  it('todo insert produz layout que passa no validateLayout', () => {
    const { layout: next } = insertBlock(layout(), 'audience_gender');
    expect(validateLayout(next).ok).toBe(true);
  });
});

describe('updateBlockText', () => {
  it('atualiza o text do bloco', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }],
    };
    const next = updateBlockText(layout(), 'c', doc);
    expect(next.blocks[2].text).toEqual(doc);
  });
});

describe('setLayoutAccent', () => {
  it('define e remove o accent', () => {
    const on = setLayoutAccent(layout(), '#0f766e');
    expect(on.accent).toBe('#0f766e');
    const off = setLayoutAccent(on, undefined);
    expect('accent' in off).toBe(false);
    expect(validateLayout(on).ok).toBe(true);
  });
  it('SIZE_ORDER é third < half < full', () => {
    expect(SIZE_ORDER).toEqual(['third', 'half', 'full']);
  });

  // Achado C2: o ColorPicker compartilhado tem allowAlpha default true (e um
  // clique num swatch recente do Estúdio pode injetar 8 dígitos mesmo com
  // allowAlpha={false} nesta página). #rrggbbaa falha o validateLayout
  // estrito e o autosave descarta sem retry — TODA edição seguinte falharia
  // até reload. setLayoutAccent precisa blindar isso.
  it('accent de 8 dígitos (#rrggbbaa): normaliza para 6 dígitos', () => {
    const next = setLayoutAccent(layout(), '#0f766eff');
    expect(next.accent).toBe('#0f766e');
    expect(validateLayout(next).ok).toBe(true);
  });

  it('accent inválido (não-hex): layout devolvido é a MESMA referência', () => {
    const l = layout();
    expect(setLayoutAccent(l, 'vermelho')).toBe(l);
  });

  it('accent de 8 dígitos que não normaliza pra 6 hex válidos (garbage): layout inalterado', () => {
    const l = layout();
    expect(setLayoutAccent(l, '#zzzzzzzz')).toBe(l);
  });
});
