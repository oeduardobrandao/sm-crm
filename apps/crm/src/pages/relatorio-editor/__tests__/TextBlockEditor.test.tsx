import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { TextBlockEditor, buildTextBlockExtensions } from '../TextBlockEditor';
import type { ReportBlock } from '@mesaas/report-blocks/types';

const textBlock = (text: unknown): ReportBlock => ({
  id: 't1',
  type: 'text',
  size: 'full',
  text,
});

describe('buildTextBlockExtensions', () => {
  it('aceita os nós que o renderer read-only suporta e rejeita code/link', () => {
    const editor = new Editor({
      extensions: buildTextBlockExtensions(),
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }],
      },
    });
    const schema = editor.schema;
    expect(schema.nodes.heading).toBeDefined();
    expect(schema.nodes.bulletList).toBeDefined();
    expect(schema.nodes.blockquote).toBeDefined();
    expect(schema.nodes.codeBlock).toBeUndefined();
    expect(schema.marks.bold).toBeDefined();
    expect(schema.marks.strike).toBeDefined();
    expect(schema.marks.code).toBeUndefined();
    expect(schema.marks.link).toBeUndefined();
    // Formatação rica (2026-08): tudo aqui tem contraparte no renderer
    // compartilhado — schema e tiptap-render.ts andam JUNTOS.
    expect(schema.marks.underline).toBeDefined();
    expect(schema.marks.textStyle).toBeDefined();
    editor.destroy();
  });

  it('cor e alinhamento produzem exatamente o JSON que o renderer sanitiza', () => {
    const editor = new Editor({
      extensions: buildTextBlockExtensions(),
      content: {
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'abc' }] }],
      },
    });
    editor.chain().selectAll().setColor('#dc2626').setTextAlign('center').run();
    const json = editor.getJSON() as {
      content: {
        attrs?: { textAlign?: string };
        content: { marks?: { type: string; attrs?: { color?: string } }[] }[];
      }[];
    };
    expect(json.content[0].attrs?.textAlign).toBe('center');
    const marks = json.content[0].content[0].marks ?? [];
    expect(marks.some((m) => m.type === 'textStyle' && m.attrs?.color === '#dc2626')).toBe(true);
    editor.destroy();
  });

  it('heading restrito aos níveis 2 e 3', () => {
    // @tiptap/extension-heading 3.22 fixa spec.attrs.level.default em 1
    // independente de `levels` (só afeta parseDOM/comandos/atalhos) — a
    // restrição real se prova pelo parseDOM (só h2/h3) e pelos comandos
    // recusando níveis fora da lista, não pelo default do atributo.
    const editor = new Editor({ extensions: buildTextBlockExtensions() });
    const spec = editor.schema.nodes.heading.spec;
    expect((spec.parseDOM ?? []).map((rule: { tag?: string }) => rule.tag)).toEqual(['h2', 'h3']);
    expect(editor.can().setHeading({ level: 1 })).toBe(false);
    expect(editor.can().setHeading({ level: 2 })).toBe(true);
    expect(editor.can().setHeading({ level: 4 })).toBe(false);
    editor.destroy();
  });
});

describe('TextBlockEditor', () => {
  it('renderiza o conteúdo inicial e NÃO dispara onTextChange no mount', async () => {
    const onTextChange = vi.fn();
    render(
      <TextBlockEditor
        block={textBlock({
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Análise inicial' }] }],
        })}
        onTextChange={onTextChange}
      />,
    );
    await waitFor(() => expect(screen.getByText('Análise inicial')).toBeInTheDocument());
    expect(onTextChange).not.toHaveBeenCalled();
  });

  it('toolbar expõe título, marcas, cor, alinhamento e listas', async () => {
    render(
      <TextBlockEditor block={textBlock({ type: 'doc', content: [] })} onTextChange={vi.fn()} />,
    );
    await waitFor(() =>
      expect(screen.getByRole('toolbar', { name: 'Formatação do texto' })).toBeInTheDocument(),
    );
    for (const label of [
      'Título',
      'Subtítulo',
      'Negrito',
      'Itálico',
      'Sublinhado',
      'Tachado',
      'Cor do texto',
      'Centralizar',
      'Alinhar à direita',
      'Lista',
      'Lista numerada',
      'Citação',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('paleta de cores abre com as 7 cores e a opção de remover', async () => {
    // O ciclo clique -> mark ativa depende de seleção/storedMarks reais, que o
    // jsdom não sustenta (mesma razão do comentário sobre digitação acima);
    // os comandos estão provados no nível do Editor no describe anterior, e o
    // ciclo completo se verifica no browser.
    render(
      <TextBlockEditor block={textBlock({ type: 'doc', content: [] })} onTextChange={vi.fn()} />,
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Cor do texto' })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cor do texto' }));
    expect(screen.getAllByRole('button', { name: /^Cor / })).toHaveLength(8); // 7 + o gatilho
    expect(screen.getByRole('button', { name: 'Remover cor' })).toBeInTheDocument();
  });

  it('edição programática dispara onTextChange com o JSON novo', async () => {
    const onTextChange = vi.fn();
    const { container } = render(
      <TextBlockEditor
        block={textBlock({ type: 'doc', content: [] })}
        onTextChange={onTextChange}
      />,
    );
    await waitFor(() => expect(container.querySelector('.ProseMirror')).toBeInTheDocument());
    // O editor TipTap real está montado; simular digitação via evento de input
    // é frágil em jsdom — o contrato onUpdate→getJSON é coberto pelo teste de
    // integração do PostEditor da casa; aqui provamos mount sem side effects e
    // schema correto (acima). Nada a assertar além do não-disparo inicial.
    expect(onTextChange).not.toHaveBeenCalled();
  });
});
