import { describe, expect, it } from 'vitest';
import { tiptapToHtml } from '../tiptap-render';

const doc = (content: unknown[]) => ({ type: 'doc', content });
const text = (t: string, marks?: { type: string }[]) => ({ type: 'text', text: t, marks });

describe('tiptapToHtml', () => {
  it('renderiza paragraph, heading e marks básicas', () => {
    const html = tiptapToHtml(
      doc([
        { type: 'heading', attrs: { level: 3 }, content: [text('Título')] },
        { type: 'paragraph', content: [text('normal '), text('forte', [{ type: 'bold' }])] },
      ]),
    );
    expect(html).toContain('<h3>Título</h3>');
    expect(html).toContain('<strong>forte</strong>');
  });

  it('renderiza listas, blockquote, hardBreak e horizontalRule', () => {
    const html = tiptapToHtml(
      doc([
        {
          type: 'bulletList',
          content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [text('a')] }] }],
        },
        { type: 'blockquote', content: [{ type: 'paragraph', content: [text('q')] }] },
        { type: 'paragraph', content: [text('x'), { type: 'hardBreak' }, text('y')] },
        { type: 'horizontalRule' },
      ]),
    );
    expect(html).toContain('<ul><li><p>a</p></li></ul>');
    expect(html).toContain('<blockquote><p>q</p></blockquote>');
    expect(html).toContain('x<br>y');
    expect(html).toContain('<hr>');
  });

  it('SEMPRE escapa texto: nenhum HTML do usuário passa cru', () => {
    const html = tiptapToHtml(
      doc([{ type: 'paragraph', content: [text('<script>alert(1)</script>')] }]),
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('nó desconhecido rende só os filhos; entrada inválida rende vazio', () => {
    expect(tiptapToHtml(null)).toBe('');
    expect(
      tiptapToHtml(
        doc([{ type: 'weirdNode', content: [{ type: 'paragraph', content: [text('ok')] }] }]),
      ),
    ).toContain('<p>ok</p>');
  });

  it('underline vira <u>', () => {
    const html = tiptapToHtml(
      doc([{ type: 'paragraph', content: [text('sub', [{ type: 'underline' }])] }]),
    );
    expect(html).toContain('<u>sub</u>');
  });

  it('cor de texto: só #rrggbb estrito entra no style', () => {
    const colored = (color: unknown) =>
      tiptapToHtml(
        doc([
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'c', marks: [{ type: 'textStyle', attrs: { color } }] },
            ],
          },
        ]),
      );
    expect(colored('#dc2626')).toContain('<span style="color: #dc2626">c</span>');
    // Qualquer outra forma descarta a mark: nome, rgb(), 8 dígitos, injeção.
    expect(colored('red')).toBe('<p>c</p>');
    expect(colored('rgb(1,2,3)')).toBe('<p>c</p>');
    expect(colored('#dc2626ff')).toBe('<p>c</p>');
    expect(colored('#fff" onmouseover="x')).toBe('<p>c</p>');
  });

  it('alinhamento: center/right/justify viram style; left e lixo não emitem atributo', () => {
    const aligned = (textAlign: unknown) =>
      tiptapToHtml(doc([{ type: 'paragraph', attrs: { textAlign }, content: [text('a')] }]));
    expect(aligned('center')).toBe('<p style="text-align: center">a</p>');
    expect(aligned('right')).toBe('<p style="text-align: right">a</p>');
    expect(aligned('left')).toBe('<p>a</p>');
    expect(aligned('start"><script>')).toBe('<p>a</p>');
    const heading = tiptapToHtml(
      doc([{ type: 'heading', attrs: { level: 2, textAlign: 'center' }, content: [text('t')] }]),
    );
    expect(heading).toBe('<h2 style="text-align: center">t</h2>');
  });
});
