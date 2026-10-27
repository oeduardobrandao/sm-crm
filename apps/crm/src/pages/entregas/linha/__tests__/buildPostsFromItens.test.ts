import { describe, expect, it } from 'vitest';
import type { JSONContent } from '@tiptap/core';
import type { TemplatePropertyDefinition } from '@/store/posts';
import type { LinhaColuna, LinhaItem } from '@/store/linhaEditorial';
import { buildPostsFromItens } from '../buildPostsFromItens';

const PILAR_OPTS = [
  { id: 'p-edu', label: 'Educação', color: '#111111' },
  { id: 'p-aut', label: 'Autoridade', color: '#222222' },
];

function coluna(
  over: Partial<LinhaColuna> & Pick<LinhaColuna, 'id' | 'nome' | 'tipo'>,
): LinhaColuna {
  return { config: {}, visivel_cliente: true, oculta: false, ordem: 0, ...over };
}

const pilar = coluna({
  id: 'c-pilar',
  nome: 'Pilar',
  tipo: 'select',
  config: { options: PILAR_OPTS },
  ordem: 0,
});
const ref = coluna({ id: 'c-ref', nome: 'Referência', tipo: 'url', ordem: 1 });

function item(over: Partial<LinhaItem> = {}): LinhaItem {
  return {
    id: 'i1',
    linha_id: 'l1',
    data: '2026-11-03',
    tipo: 'reels',
    titulo: 'Reel 1',
    direcao: 'Abrir com a pergunta.\nMostrar o antes e depois.',
    valores: {},
    ordem: 0,
    post_id: null,
    ...over,
  };
}

function def(over: Partial<TemplatePropertyDefinition>): TemplatePropertyDefinition {
  return {
    id: 10,
    template_id: 1,
    name: 'pilar',
    type: 'select',
    config: {
      options: [
        { id: 'd-edu', label: 'educacao', color: '#000000' },
        { id: 'd-aut', label: 'Autoridade', color: '#000000' },
      ],
    },
    portal_visible: false,
    display_order: 0,
    ...over,
  };
}

const textOf = (n: JSONContent): string => n.text ?? (n.content ?? []).map(textOf).join('');
function paragraphs(doc: JSONContent): string[] {
  const out: string[] = [];
  for (const b of doc.content ?? []) {
    if (b.type === 'bulletList') for (const li of b.content ?? []) out.push(textOf(li));
    else out.push(textOf(b));
  }
  return out;
}

describe('buildPostsFromItens', () => {
  it('puts the direction lines as paragraphs under a bold "Direção do conteúdo"', () => {
    const [p] = buildPostsFromItens([item()], [], null);
    const [head, l1, l2] = p.conteudo.content!;
    expect(p.item_id).toBe('i1');
    expect(head.content![0]).toMatchObject({
      type: 'text',
      text: 'Direção do conteúdo',
      marks: [{ type: 'bold' }],
    });
    expect(l1).toMatchObject({ type: 'paragraph' });
    expect(textOf(l1)).toBe('Abrir com a pergunta.');
    expect(textOf(l2)).toBe('Mostrar o antes e depois.');
  });

  it('renders an unmapped Pilar as the bullet "Pilar: Educação"', () => {
    const [p] = buildPostsFromItens([item({ valores: { 'c-pilar': 'p-edu' } })], [pilar], null);
    const list = p.conteudo.content!.find((b) => b.type === 'bulletList')!;
    expect(textOf(list.content![0])).toBe('Pilar: Educação');
    expect(p.property_values).toEqual([]);
    const titulo = p.conteudo.content![3];
    expect(textOf(titulo)).toBe('Da linha editorial');
    expect(titulo.content![0].marks).toEqual([{ type: 'bold' }]);
  });

  it('maps Pilar to the "pilar" definition (accent/case insensitive) with the option id by label', () => {
    const [p] = buildPostsFromItens(
      [item({ valores: { 'c-pilar': 'p-edu' } })],
      [pilar],
      [def({ name: ' PILAR ' })],
    );
    expect(p.property_values).toEqual([{ property_definition_id: 10, value: 'd-edu' }]);
    expect(p.conteudo.content!.some((b) => b.type === 'bulletList')).toBe(false);
  });

  it('falls back to the bullet when the select label has no matching option', () => {
    const [p] = buildPostsFromItens(
      [item({ valores: { 'c-pilar': 'p-edu' } })],
      [pilar],
      [def({ config: { options: [{ id: 'x', label: 'Outro', color: '#000' }] } })],
    );
    expect(p.property_values).toEqual([]);
    expect(paragraphs(p.conteudo)).toContain('Pilar: Educação');
  });

  it('does not map to a definition of an incompatible type', () => {
    const [p] = buildPostsFromItens(
      [item({ valores: { 'c-pilar': 'p-edu' } })],
      [pilar],
      [def({ type: 'text', config: {} })],
    );
    expect(p.property_values).toEqual([]);
    expect(paragraphs(p.conteudo)).toContain('Pilar: Educação');
  });

  it('renders a URL bullet with a link mark', () => {
    const [p] = buildPostsFromItens(
      [item({ valores: { 'c-ref': 'https://exemplo.com/ref' } })],
      [ref],
      null,
    );
    const list = p.conteudo.content!.find((b) => b.type === 'bulletList')!;
    const para = list.content![0].content![0];
    expect(para.content).toEqual([
      { type: 'text', text: 'Referência: ' },
      {
        type: 'text',
        text: 'https://exemplo.com/ref',
        marks: [{ type: 'link', attrs: { href: 'https://exemplo.com/ref' } }],
      },
    ]);
  });

  it('skips empty values (and omits the "Da linha editorial" block when nothing is left)', () => {
    const [p] = buildPostsFromItens(
      [item({ valores: { 'c-pilar': '', 'c-ref': null, 'c-x': [] } })],
      [pilar, ref, coluna({ id: 'c-x', nome: 'Tags', tipo: 'multiselect' })],
      [def({})],
    );
    expect(p.property_values).toEqual([]);
    expect(paragraphs(p.conteudo)).not.toContain('Da linha editorial');
  });

  it('puts every column in the bullets when there are no definitions', () => {
    const [p] = buildPostsFromItens(
      [item({ valores: { 'c-pilar': 'p-aut', 'c-ref': 'https://a.co' } })],
      [pilar, ref],
      null,
    );
    expect(p.property_values).toEqual([]);
    expect(paragraphs(p.conteudo)).toEqual(
      expect.arrayContaining(['Pilar: Autoridade', 'Referência: https://a.co']),
    );
  });

  it('ignores valores keys that have no matching column', () => {
    const [p] = buildPostsFromItens([item({ valores: { 'c-gone': 'zzz' } })], [pilar], [def({})]);
    expect(p.property_values).toEqual([]);
    expect(p.conteudo_plain).not.toContain('zzz');
  });

  it('keeps conteudo_plain equal to the doc text joined by newlines', () => {
    const [p] = buildPostsFromItens(
      [item({ valores: { 'c-pilar': 'p-edu', 'c-ref': 'https://a.co' } })],
      [pilar, ref],
      null,
    );
    expect(p.conteudo_plain).toBe(
      [
        'Direção do conteúdo',
        'Abrir com a pergunta.',
        'Mostrar o antes e depois.',
        'Da linha editorial',
        'Pilar: Educação',
        'Referência: https://a.co',
      ].join('\n'),
    );
    expect(p.conteudo_plain).toBe(paragraphs(p.conteudo).join('\n'));
  });

  it('returns one payload per item, in the given order, with a valid empty doc', () => {
    const out = buildPostsFromItens([item({ id: 'a', direcao: '' }), item({ id: 'b' })], [], null);
    expect(out.map((o) => o.item_id)).toEqual(['a', 'b']);
    expect(out[0].conteudo).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
    expect(out[0].conteudo_plain).toBe('');
  });
});
