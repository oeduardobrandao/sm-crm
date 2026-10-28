import { describe, expect, it } from 'vitest';
import {
  addSection,
  insertBlock,
  insertBlockInSection,
  moveBlock,
  moveSection,
  normalizeCoverColorPatch,
  normalizeCoverSize,
  removeBlock,
  removeSection,
  reorderSections,
  resizeBlock,
  resolveDragEnd,
  setBlockSize,
  restoreBlock,
  restoreSection,
  setLayoutAccent,
  setLayoutFonts,
  setLayoutTheme,
  SIZE_ORDER,
  stepCoverLogoSize,
  updateBlockConfig,
  updateBlockText,
  updateSectionConfig,
} from '../layoutOps';
import {
  MAX_BLOCKS,
  MAX_SECTIONS,
  sectionizeLayout,
  toSections,
  validateLayout,
  type ReportBlock,
  type ReportLayout,
} from '@mesaas/report-blocks/types';

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
  it('capa é sempre full: MESMA referência', () => {
    const l = layout();
    expect(resizeBlock(l, 'a', -1)).toBe(l);
  });
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

describe('restoreBlock', () => {
  it('com MAX_BLOCKS de conteúdo já no layout: MESMA referência', () => {
    const full: ReportLayout = {
      version: 1,
      blocks: [
        { id: 'g', type: 'section', size: 'full' },
        ...Array.from({ length: MAX_BLOCKS }, (_, i) => ({
          id: `d${i}`,
          type: 'divider' as const,
          size: 'full' as const,
        })),
      ],
    };
    expect(restoreBlock(full, { id: 'x', type: 'text', size: 'full' }, 1)).toBe(full);
    const legacy: ReportLayout = { version: 1, blocks: full.blocks.slice(1) };
    expect(restoreBlock(legacy, { id: 'x', type: 'text', size: 'full' }, 0)).toBe(legacy);
  });

  it('restaura o bloco na posição de origem', () => {
    const l = removeBlock(layout(), 'b');
    const restored = restoreBlock(l, { id: 'b', type: 'kpi_reach', size: 'third' }, 1);
    expect(restored.blocks.map((b) => b.id)).toEqual(['a', 'b', 'c']);
  });

  it('index maior que o array clampa pro fim', () => {
    const l = removeBlock(layout(), 'a');
    const restored = restoreBlock(l, { id: 'a', type: 'cover', size: 'full' }, 99);
    expect(restored.blocks.map((b) => b.id)).toEqual(['b', 'c', 'a']);
  });

  it('id já presente: devolve a MESMA referência', () => {
    const l = layout();
    expect(restoreBlock(l, { id: 'a', type: 'cover', size: 'full' }, 0)).toBe(l);
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
    expect(sh.config).toEqual({ title: 'Novo subtítulo' });
  });
  it('todo insert produz layout que passa no validateLayout', () => {
    const { layout: next } = insertBlock(layout(), 'audience_gender');
    expect(validateLayout(next).ok).toBe(true);
  });
});

describe('updateBlockConfig', () => {
  it('faz merge raso preservando as chaves existentes', () => {
    const l: ReportLayout = {
      version: 1,
      blocks: [{ id: 's', type: 'section_header', size: 'full', config: { title: 'A', x: 1 } }],
    };
    const next = updateBlockConfig(l, 's', { title: 'Novo título' });
    expect(next.blocks[0].config).toEqual({ title: 'Novo título', x: 1 });
    expect(l.blocks[0].config?.title).toBe('A'); // imutável
  });

  it('bloco sem config: cria; id inexistente: MESMA referência', () => {
    const l = layout();
    const next = updateBlockConfig(l, 'a', { title: 'T' });
    expect(next.blocks[0].config).toEqual({ title: 'T' });
    expect(updateBlockConfig(l, 'zzz', { title: 'T' })).toBe(l);
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

describe('setLayoutTheme / setLayoutFonts', () => {
  it('define, troca e remove com undefined', () => {
    let l = setLayoutTheme(layout(), 'editorial');
    expect(l.theme).toBe('editorial');
    l = setLayoutFonts(l, 'fraunces');
    expect(l.fonts).toBe('fraunces');
    const off = setLayoutTheme(l, undefined);
    expect('theme' in off).toBe(false);
    expect(off.fonts).toBe('fraunces');
  });
  it('mesmo valor devolve a MESMA referencia (contrato do autosave)', () => {
    const l = setLayoutTheme(layout(), 'bold');
    expect(setLayoutTheme(l, 'bold')).toBe(l);
    const base = layout();
    expect(setLayoutTheme(base, undefined)).toBe(base);
  });
  it('setLayoutFonts: mesma referência quando o valor não muda', () => {
    const l = setLayoutFonts(layout(), 'grotesk');
    expect(setLayoutFonts(l, 'grotesk')).toBe(l);
    const base = layout();
    expect(setLayoutFonts(base, undefined)).toBe(base);
  });
});

describe('normalizeCoverColorPatch', () => {
  it('cor válida de 6 dígitos: patch com a mesma cor', () => {
    expect(normalizeCoverColorPatch('#0f766e')).toEqual({ color: '#0f766e' });
  });
  it('cor de 8 dígitos: normaliza para 6', () => {
    expect(normalizeCoverColorPatch('#0f766eff')).toEqual({ color: '#0f766e' });
  });
  it('cor inválida (não-hex): patch vazio', () => {
    expect(normalizeCoverColorPatch('vermelho')).toEqual({});
  });
  it('cor de 8 dígitos que não normaliza pra 6 hex válidos: patch vazio', () => {
    expect(normalizeCoverColorPatch('#zzzzzzzz')).toEqual({});
  });
  it('undefined: patch remove a chave (herda o accent)', () => {
    expect(normalizeCoverColorPatch(undefined)).toEqual({ color: undefined });
  });
});

describe('stepCoverLogoSize', () => {
  it('sem valor atual: parte do default (36) e soma o passo', () => {
    expect(stepCoverLogoSize(undefined, 1)).toBe(44);
    expect(stepCoverLogoSize(undefined, -1)).toBe(28);
  });
  it('clampa no teto (68) e no piso (20)', () => {
    expect(stepCoverLogoSize(68, 1)).toBe(68);
    expect(stepCoverLogoSize(20, -1)).toBe(20);
  });
  it('soma/subtrai 8px a partir do valor atual', () => {
    expect(stepCoverLogoSize(44, 1)).toBe(52);
    expect(stepCoverLogoSize(44, -1)).toBe(36);
  });
});

describe('normalizeCoverSize', () => {
  it('corrige um bloco cover com size != full para full', () => {
    const l: ReportLayout = {
      version: 1,
      blocks: [{ id: 'c', type: 'cover', size: 'third' }],
    };
    const next = normalizeCoverSize(l);
    expect(next.blocks[0].size).toBe('full');
  });

  it('cover já full: devolve a MESMA referência (no-op)', () => {
    const l: ReportLayout = {
      version: 1,
      blocks: [{ id: 'c', type: 'cover', size: 'full' }],
    };
    expect(normalizeCoverSize(l)).toBe(l);
  });

  it('não mexe em blocos que não são cover', () => {
    const l: ReportLayout = {
      version: 1,
      blocks: [{ id: 'k', type: 'kpi_reach', size: 'third' }],
    };
    expect(normalizeCoverSize(l)).toBe(l);
  });
});

describe('setBlockSize', () => {
  const base = (): ReportLayout => ({
    version: 1,
    blocks: [
      { id: 'i', type: 'image', size: 'full' },
      { id: 'c', type: 'cover', size: 'full' },
    ],
  });
  it('muda o size do bloco', () => {
    expect(setBlockSize(base(), 'i', 'half').blocks[0].size).toBe('half');
  });
  it('mesmo size, id inexistente ou capa: MESMA referência', () => {
    const l = base();
    expect(setBlockSize(l, 'i', 'full')).toBe(l);
    expect(setBlockSize(l, 'x', 'half')).toBe(l);
    expect(setBlockSize(l, 'c', 'half')).toBe(l);
  });
});

// Seções (spec 2026-10-28-report-platform-sections §Editor): entrada canônica,
// saída canônica (validateLayout ok) e no-op = MESMA referência.
const sectioned = (): ReportLayout => ({
  version: 1,
  accent: '#0f766e',
  blocks: [
    { id: 'g', type: 'section', size: 'full' },
    { id: 'cv', type: 'cover', size: 'full' },
    { id: 'ig', type: 'section', size: 'full', config: { platform: 'instagram' } },
    { id: 'r', type: 'kpi_reach', size: 'third' },
    { id: 'v', type: 'kpi_views', size: 'third' },
    { id: 'tt', type: 'section', size: 'full', config: { platform: 'tiktok', title: 'Vídeos' } },
    { id: 'tv', type: 'tiktok_kpi_views', size: 'third' },
  ],
});
const ids = (l: ReportLayout) => l.blocks.map((b) => b.id);
const expectValid = (l: ReportLayout) => expect(validateLayout(l)).toMatchObject({ ok: true });
const counter = (prefix = 'n') => {
  let n = 0;
  return () => `${prefix}${++n}`;
};

describe('insertBlockInSection', () => {
  it('KPI do TikTok na seção TikTok entra no fim, como third', () => {
    const next = insertBlockInSection(sectioned(), 'tt', 'tiktok_kpi_likes', undefined, () => 'k');
    expect(ids(next)).toEqual(['g', 'cv', 'ig', 'r', 'v', 'tt', 'tv', 'k']);
    expect(next.blocks.at(-1)).toEqual({ id: 'k', type: 'tiktok_kpi_likes', size: 'third' });
    expectValid(next);
  });

  it('position é o índice dentro da seção (clampado)', () => {
    const at0 = insertBlockInSection(sectioned(), 'ig', 'kpi_saves', 0, () => 'k');
    expect(ids(at0)).toEqual(['g', 'cv', 'ig', 'k', 'r', 'v', 'tt', 'tv']);
    const at1 = insertBlockInSection(sectioned(), 'ig', 'kpi_saves', 1, () => 'k');
    expect(ids(at1)).toEqual(['g', 'cv', 'ig', 'r', 'k', 'v', 'tt', 'tv']);
    const far = insertBlockInSection(sectioned(), 'ig', 'kpi_saves', 99, () => 'k');
    expect(ids(far)).toEqual(['g', 'cv', 'ig', 'r', 'v', 'k', 'tt', 'tv']);
    const neg = insertBlockInSection(sectioned(), 'ig', 'kpi_saves', -3, () => 'k');
    expect(ids(neg)).toEqual(['g', 'cv', 'ig', 'k', 'r', 'v', 'tt', 'tv']);
    [at0, at1, far, neg].forEach(expectValid);
  });

  it('neutro entra em qualquer seção, com os defaults por tipo', () => {
    const next = insertBlockInSection(sectioned(), 'ig', 'text', undefined, () => 't');
    expect(next.blocks[5]).toEqual({
      id: 't',
      type: 'text',
      size: 'full',
      text: { type: 'doc', content: [{ type: 'paragraph', content: [] }] },
    });
    const sh = insertBlockInSection(sectioned(), 'g', 'section_header', 0, () => 's');
    expect(sh.blocks[1]).toEqual({
      id: 's',
      type: 'section_header',
      size: 'full',
      config: { title: 'Novo subtítulo' },
    });
    expectValid(next);
    expectValid(sh);
  });

  it('seção inexistente, plataforma errada, marcador ou limite: MESMA referência', () => {
    const l = sectioned();
    expect(insertBlockInSection(l, 'nope', 'text')).toBe(l);
    expect(insertBlockInSection(l, 'r', 'text')).toBe(l); // id de bloco, não de seção
    expect(insertBlockInSection(l, 'ig', 'tiktok_kpi_views')).toBe(l);
    expect(insertBlockInSection(l, 'g', 'kpi_reach')).toBe(l);
    expect(insertBlockInSection(l, 'g', 'section')).toBe(l);
    const full: ReportLayout = {
      version: 1,
      blocks: [
        { id: 'g', type: 'section', size: 'full' },
        ...Array.from({ length: MAX_BLOCKS }, (_, i) => ({
          id: `d${i}`,
          type: 'divider' as const,
          size: 'full' as const,
        })),
      ],
    };
    expectValid(full);
    expect(insertBlockInSection(full, 'g', 'text')).toBe(full);
  });

  it('não muta a entrada', () => {
    const l = sectioned();
    insertBlockInSection(l, 'ig', 'kpi_saves');
    expect(ids(l)).toEqual(['g', 'cv', 'ig', 'r', 'v', 'tt', 'tv']);
  });
});

describe('insertBlock (fim do relatório)', () => {
  it('legado: anexa no fim do array', () => {
    const { layout: next, newId } = insertBlock(layout(), 'tiktok_kpi_views', () => 'k');
    expect(newId).toBe('k');
    expect(ids(next)).toEqual(['a', 'b', 'c', 'k']);
    expect(next.blocks.at(-1)?.size).toBe('third');
  });

  it('seccionado: fim da última seção que aceita o tipo', () => {
    const neutral = insertBlock(sectioned(), 'divider', () => 'd').layout;
    expect(ids(neutral)).toEqual(['g', 'cv', 'ig', 'r', 'v', 'tt', 'tv', 'd']);
    const ig = insertBlock(sectioned(), 'kpi_saves', () => 'k').layout;
    expect(ids(ig)).toEqual(['g', 'cv', 'ig', 'r', 'v', 'k', 'tt', 'tv']);
    expectValid(neutral);
    expectValid(ig);
  });

  it('seccionado sem seção da plataforma: MESMA referência', () => {
    const l: ReportLayout = { version: 1, blocks: [{ id: 'g', type: 'section', size: 'full' }] };
    expect(insertBlock(l, 'kpi_reach', () => 'k').layout).toBe(l);
  });
});

describe('addSection', () => {
  it('adiciona depois da seção dada, com marcador visível e os blocos', () => {
    const blocks: ReportBlock[] = [{ id: 'x', type: 'text', size: 'full' }];
    const next = addSection(sectioned(), 'general', 'g', blocks, () => 'ns');
    expect(ids(next)).toEqual(['g', 'cv', 'ns', 'x', 'ig', 'r', 'v', 'tt', 'tv']);
    expect(next.blocks[2]).toEqual({ id: 'ns', type: 'section', size: 'full' });
    expect(next.accent).toBe('#0f766e');
    expectValid(next);
  });

  it('null = depois da última; plataforma nova sem hideHeader', () => {
    const l: ReportLayout = {
      version: 1,
      blocks: [
        { id: 'g', type: 'section', size: 'full' },
        { id: 'ig', type: 'section', size: 'full', config: { platform: 'instagram' } },
      ],
    };
    const next = addSection(
      l,
      'tiktok',
      null,
      [{ id: 'k', type: 'tiktok_kpi_views', size: 'third' }],
      () => 'ns',
    );
    expect(ids(next)).toEqual(['g', 'ig', 'ns', 'k']);
    expect(next.blocks[2]).toEqual({
      id: 'ns',
      type: 'section',
      size: 'full',
      config: { platform: 'tiktok' },
    });
    expectValid(next);
  });

  it('layout vazio ganha a primeira seção; Geral começa vazia', () => {
    const empty: ReportLayout = { version: 1, blocks: [] };
    const next = addSection(empty, 'general', null, undefined, () => 'ns');
    expect(next.blocks).toEqual([{ id: 'ns', type: 'section', size: 'full' }]);
    expectValid(next);
  });

  it('plataforma repetida, seção âncora inexistente ou blocos incompatíveis: MESMA referência', () => {
    const l = sectioned();
    expect(addSection(l, 'tiktok', null)).toBe(l);
    expect(addSection(l, 'instagram', 'g')).toBe(l);
    expect(addSection(l, 'general', 'nope')).toBe(l);
    expect(addSection(l, 'general', null, [{ id: 'z', type: 'kpi_reach', size: 'third' }])).toBe(l);
    expect(addSection(l, 'general', null, [{ id: 'r', type: 'text', size: 'full' }])).toBe(l);
    expect(addSection(l, 'general', null, [{ id: 'z', type: 'section', size: 'full' }])).toBe(l);
  });

  it('respeita MAX_SECTIONS e MAX_BLOCKS', () => {
    const many: ReportLayout = {
      version: 1,
      blocks: Array.from({ length: MAX_SECTIONS }, (_, i) => ({
        id: `s${i}`,
        type: 'section' as const,
        size: 'full' as const,
      })),
    };
    expectValid(many);
    expect(addSection(many, 'general', null)).toBe(many);

    const full: ReportLayout = {
      version: 1,
      blocks: [
        { id: 'g', type: 'section', size: 'full' },
        ...Array.from({ length: MAX_BLOCKS }, (_, i) => ({
          id: `d${i}`,
          type: 'divider' as const,
          size: 'full' as const,
        })),
      ],
    };
    expect(addSection(full, 'general', null)).not.toBe(full); // seção vazia cabe
    expect(addSection(full, 'general', null, [{ id: 'x', type: 'text', size: 'full' }])).toBe(full);
  });
});

describe('removeSection / restoreSection', () => {
  it('remove o marcador e os blocos da seção', () => {
    const next = removeSection(sectioned(), 'ig');
    expect(ids(next)).toEqual(['g', 'cv', 'tt', 'tv']);
    expectValid(next);
  });

  it('remover a primeira seção mantém o layout canônico', () => {
    const next = removeSection(sectioned(), 'g');
    expect(ids(next)).toEqual(['ig', 'r', 'v', 'tt', 'tv']);
    expectValid(next);
  });

  it('remover e desfazer devolve o layout original (mesmos ids, mesma posição)', () => {
    const original = sectioned();
    for (const id of ['g', 'ig', 'tt']) {
      const sections = toSections(original);
      const index = sections.findIndex((s) => s.marker.id === id);
      const removed = removeSection(original, id);
      const restored = restoreSection(removed, sections[index], index);
      expect(restored).toEqual(original);
      expectValid(restored);
    }
  });

  it('id inexistente ou de bloco: MESMA referência', () => {
    const l = sectioned();
    expect(removeSection(l, 'nope')).toBe(l);
    expect(removeSection(l, 'r')).toBe(l);
  });

  it('restoreSection: id já presente ou plataforma repetida = MESMA referência; índice clampado', () => {
    const l = sectioned();
    const [, igSection] = toSections(l);
    expect(restoreSection(l, igSection, 1)).toBe(l);

    const removed = removeSection(l, 'ig');
    const clone = { ...igSection, marker: { ...igSection.marker, id: 'ig2' }, blocks: [] };
    const withOther = restoreSection(removed, clone, 1);
    expect(restoreSection(withOther, igSection, 1)).toBe(withOther);

    const atEnd = restoreSection(removed, igSection, 99);
    expect(ids(atEnd)).toEqual(['g', 'cv', 'tt', 'tv', 'ig', 'r', 'v']);
    expectValid(atEnd);
  });
});

describe('moveSection / reorderSections', () => {
  it('moveSection troca com a vizinha e leva os blocos junto', () => {
    const down = moveSection(sectioned(), 'g', 1);
    expect(ids(down)).toEqual(['ig', 'r', 'v', 'g', 'cv', 'tt', 'tv']);
    const up = moveSection(sectioned(), 'tt', -1);
    expect(ids(up)).toEqual(['g', 'cv', 'tt', 'tv', 'ig', 'r', 'v']);
    expectValid(down);
    expectValid(up);
  });

  it('moveSection na borda ou id inexistente: MESMA referência', () => {
    const l = sectioned();
    expect(moveSection(l, 'g', -1)).toBe(l);
    expect(moveSection(l, 'tt', 1)).toBe(l);
    expect(moveSection(l, 'nope', 1)).toBe(l);
  });

  it('reorderSections leva a ativa para a posição da alvo', () => {
    const next = reorderSections(sectioned(), 'g', 'tt');
    expect(ids(next)).toEqual(['ig', 'r', 'v', 'tt', 'tv', 'g', 'cv']);
    const back = reorderSections(sectioned(), 'tt', 'g');
    expect(ids(back)).toEqual(['tt', 'tv', 'g', 'cv', 'ig', 'r', 'v']);
    expectValid(next);
    expectValid(back);
  });

  it('reorderSections com a mesma seção, id inexistente ou id de bloco: MESMA referência', () => {
    const l = sectioned();
    expect(reorderSections(l, 'g', 'g')).toBe(l);
    expect(reorderSections(l, 'g', 'nope')).toBe(l);
    expect(reorderSections(l, 'g', 'r')).toBe(l);
  });
});

describe('updateSectionConfig', () => {
  it('título com trim; "" ou null remove a chave', () => {
    const named = updateSectionConfig(sectioned(), 'g', { title: '  Resumo do mês  ' });
    expect(named.blocks[0]).toEqual({
      id: 'g',
      type: 'section',
      size: 'full',
      config: { title: 'Resumo do mês' },
    });
    expect(updateSectionConfig(named, 'g', { title: '' }).blocks[0]).toEqual({
      id: 'g',
      type: 'section',
      size: 'full',
    });
    expect(updateSectionConfig(sectioned(), 'tt', { title: null }).blocks[5]).toEqual({
      id: 'tt',
      type: 'section',
      size: 'full',
      config: { platform: 'tiktok' },
    });
    expectValid(named);
  });

  it('hideHeader: true liga, false remove a chave; só em plataforma', () => {
    const hidden = updateSectionConfig(sectioned(), 'ig', { hideHeader: true });
    expect(hidden.blocks[2].config).toEqual({ platform: 'instagram', hideHeader: true });
    expectValid(hidden);
    const shown = updateSectionConfig(hidden, 'ig', { hideHeader: false });
    expect(shown.blocks[2]).toEqual({
      id: 'ig',
      type: 'section',
      size: 'full',
      config: { platform: 'instagram' },
    });
    const g = sectioned();
    expect(updateSectionConfig(g, 'g', { hideHeader: true })).toBe(g);
  });

  it('81 caracteres rejeitado; 80 aceito; só espaços remove', () => {
    const l = sectioned();
    expect(updateSectionConfig(l, 'g', { title: 'a'.repeat(81) })).toBe(l);
    const ok = updateSectionConfig(l, 'g', { title: 'a'.repeat(80) });
    expect(ok.blocks[0].config).toEqual({ title: 'a'.repeat(80) });
    expectValid(ok);
  });

  it('sem mudança, id inexistente ou id de bloco: MESMA referência', () => {
    const l = sectioned();
    expect(updateSectionConfig(l, 'tt', { title: ' Vídeos ' })).toBe(l);
    expect(updateSectionConfig(l, 'ig', { hideHeader: false })).toBe(l);
    expect(updateSectionConfig(l, 'g', { title: null })).toBe(l);
    expect(updateSectionConfig(l, 'g', {})).toBe(l);
    expect(updateSectionConfig(l, 'nope', { title: 'x' })).toBe(l);
    expect(updateSectionConfig(l, 'r', { title: 'x' })).toBe(l);
  });
});

describe('ops de bloco em layout seccionado', () => {
  it('moveBlock dentro da seção funciona', () => {
    const next = moveBlock(sectioned(), 'r', 'v');
    expect(ids(next)).toEqual(['g', 'cv', 'ig', 'v', 'r', 'tt', 'tv']);
    expectValid(next);
  });

  it('moveBlock para outra seção ou envolvendo marcador: MESMA referência', () => {
    const l = sectioned();
    expect(moveBlock(l, 'cv', 'r')).toBe(l);
    expect(moveBlock(l, 'r', 'tv')).toBe(l);
    expect(moveBlock(l, 'r', 'tt')).toBe(l);
    expect(moveBlock(l, 'r', 'ig')).toBe(l);
    expect(moveBlock(l, 'ig', 'g')).toBe(l);
  });

  it('marcador não é redimensionado, removido nem editado como bloco', () => {
    const l = sectioned();
    expect(resizeBlock(l, 'g', -1)).toBe(l);
    expect(setBlockSize(l, 'g', 'half')).toBe(l);
    expect(removeBlock(l, 'ig')).toBe(l);
    expect(updateBlockConfig(l, 'ig', { platform: 'tiktok' })).toBe(l);
    expect(updateBlockText(l, 'g', { type: 'doc', content: [] })).toBe(l);
  });

  it('restoreBlock no lugar de origem volta; num lugar que quebraria a seção: MESMA referência', () => {
    const l = sectioned();
    const r = l.blocks[3];
    const removed = removeBlock(l, 'r');
    const back = restoreBlock(removed, r, 3);
    expect(back).toEqual(l);
    expectValid(back);
    expect(restoreBlock(removed, r, 0)).toBe(removed); // antes da primeira seção
    expect(restoreBlock(removed, r, 1)).toBe(removed); // dentro da Geral
    expect(restoreBlock(removed, r, 99)).toBe(removed); // fim = seção TikTok
    expect(restoreBlock(removed, { id: 'z', type: 'section', size: 'full' }, 2)).toBe(removed);
  });

  // Excluir o último bloco, remover a seção que ficou vazia e então "Desfazer"
  // no toast do bloco: o layout está vazio e o bloco volta numa seção nova,
  // canônica (sem isso entrava sem marcador e o editor caía em legado).
  it.each([
    ['de plataforma (Instagram)', 'instagram', { id: 'r', type: 'kpi_reach', size: 'third' }],
    ['de plataforma (TikTok)', 'tiktok', { id: 'r', type: 'tiktok_kpi_views', size: 'third' }],
    ['neutro', 'general', { id: 'r', type: 'cover', size: 'full' }],
  ] as const)('restoreBlock em layout vazio: bloco %s volta numa seção nova', (_l, kind, b) => {
    const block: ReportBlock = { ...b };
    const start: ReportLayout = {
      version: 1,
      accent: '#0f766e',
      blocks: [
        kind === 'general'
          ? { id: 's', type: 'section', size: 'full' }
          : { id: 's', type: 'section', size: 'full', config: { platform: kind } },
        block,
      ],
    };
    const empty = removeSection(removeBlock(start, 'r'), 's');
    expect(empty.blocks).toEqual([]);
    const back = restoreBlock(empty, block, 1, counter('m'));
    expect(back.blocks).toEqual([
      kind === 'general'
        ? { id: 'm1', type: 'section', size: 'full' }
        : { id: 'm1', type: 'section', size: 'full', config: { platform: kind } },
      block,
    ]);
    expect(back.accent).toBe('#0f766e');
    expect(sectionizeLayout(back)).toBe(back);
    expectValid(back);
  });
});

describe('DEFAULT_SIZE do TikTok', () => {
  it('todo tiktok_kpi_* entra como third', () => {
    for (const type of [
      'tiktok_kpi_followers_total',
      'tiktok_kpi_followers_gained',
      'tiktok_kpi_views',
      'tiktok_kpi_engagement_rate',
      'tiktok_kpi_likes',
      'tiktok_kpi_comments',
      'tiktok_kpi_shares',
      'tiktok_kpi_posts_count',
      'tiktok_kpi_likes_total',
    ] as const) {
      const next = insertBlockInSection(sectioned(), 'tt', type, undefined, counter());
      expect(next.blocks.at(-1)?.size).toBe('third');
    }
    const list = insertBlockInSection(sectioned(), 'tt', 'tiktok_post_list', undefined, counter());
    expect(list.blocks.at(-1)?.size).toBe('full');
  });
});

describe('resolveDragEnd (canvas e camadas)', () => {
  it('marcador sobre outro marcador: reordena as seções', () => {
    const l = sectioned();
    const next = resolveDragEnd(l, 'tt', 'ig');
    expect(ids(next)).toEqual(['g', 'cv', 'tt', 'tv', 'ig', 'r', 'v']);
    expectValid(next);
  });

  it('marcador sobre um bloco de outra seção: usa a seção dono do bloco', () => {
    const l = sectioned();
    const next = resolveDragEnd(l, 'ig', 'tv');
    expect(ids(next)).toEqual(['g', 'cv', 'tt', 'tv', 'ig', 'r', 'v']);
  });

  it('marcador sobre um bloco da própria seção: MESMA referência', () => {
    const l = sectioned();
    expect(resolveDragEnd(l, 'ig', 'r')).toBe(l);
  });

  it('bloco sobre bloco da mesma seção: move', () => {
    const l = sectioned();
    expect(ids(resolveDragEnd(l, 'v', 'r'))).toEqual(['g', 'cv', 'ig', 'v', 'r', 'tt', 'tv']);
  });

  it('bloco sobre bloco de outra seção ou sobre um marcador: MESMA referência', () => {
    const l = sectioned();
    expect(resolveDragEnd(l, 'r', 'tv')).toBe(l);
    expect(resolveDragEnd(l, 'cv', 'r')).toBe(l);
    expect(resolveDragEnd(l, 'r', 'tt')).toBe(l);
  });

  it('mesmo id ou id desconhecido: MESMA referência', () => {
    const l = sectioned();
    expect(resolveDragEnd(l, 'ig', 'ig')).toBe(l);
    expect(resolveDragEnd(l, 'nope', 'ig')).toBe(l);
    expect(resolveDragEnd(l, 'ig', 'nope')).toBe(l);
  });
});
