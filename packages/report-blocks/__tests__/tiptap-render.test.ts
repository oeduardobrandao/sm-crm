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
});
