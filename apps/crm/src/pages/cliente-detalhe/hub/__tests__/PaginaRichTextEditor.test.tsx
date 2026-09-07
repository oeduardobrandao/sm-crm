import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PaginaRichTextEditor } from '../PaginaRichTextEditor';

describe('PaginaRichTextEditor', () => {
  it('emite o documento a cada edição', async () => {
    const onChange = vi.fn();
    render(<PaginaRichTextEditor doc={{ type: 'doc', content: [] }} onChange={onChange} />);
    await userEvent.type(screen.getByRole('textbox'), 'Olá');
    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls.at(-1)![0];
    expect(JSON.stringify(last)).toContain('Olá');
  });

  it('não dispara onChange no mount', () => {
    const onChange = vi.fn();
    render(<PaginaRichTextEditor doc={{ type: 'doc', content: [] }} onChange={onChange} />);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renderiza a barra fixa com os 10 controles do plano, cada um com nome acessível', () => {
    render(<PaginaRichTextEditor doc={{ type: 'doc', content: [] }} onChange={vi.fn()} />);
    const toolbar = screen.getByRole('toolbar', { name: 'Formatação do texto' });
    const labels = [
      'Negrito',
      'Itálico',
      'Sublinhado',
      'Título 2',
      'Título 3',
      'Lista com marcadores',
      'Lista numerada',
      'Citação',
      'Link',
      'Destacar',
    ];
    for (const label of labels) {
      expect(screen.getByRole('button', { name: label, hidden: false })).toBeInTheDocument();
    }
    // Nenhum rótulo se repete dentro da barra fixa -- cada controle tem nome único.
    const toolbarButtons = toolbar.querySelectorAll('button[aria-label]');
    const toolbarLabels = Array.from(toolbarButtons).map((b) => b.getAttribute('aria-label'));
    expect(new Set(toolbarLabels).size).toBe(toolbarLabels.length);
  });

  it('não expõe nenhum controle de imagem -- fora de escopo deste editor', () => {
    render(<PaginaRichTextEditor doc={{ type: 'doc', content: [] }} onChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /imagem/i })).not.toBeInTheDocument();
  });

  it('negrito na barra fixa alterna o marcador e reflete no JSON emitido', async () => {
    const onChange = vi.fn();
    render(
      <PaginaRichTextEditor
        doc={{
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'abc' }] }],
        }}
        onChange={onChange}
      />,
    );
    const textbox = screen.getByRole('textbox');
    await userEvent.click(textbox);
    // seleciona todo o texto do parágrafo antes de aplicar a marca
    await userEvent.keyboard('{Control>}a{/Control}');
    await userEvent.click(screen.getByRole('button', { name: 'Negrito' }));

    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls.at(-1)![0] as {
      content: { content: { marks?: { type: string }[] }[] }[];
    };
    const marks = last.content[0]?.content[0]?.marks ?? [];
    expect(marks.some((m) => m.type === 'bold')).toBe(true);
  });

  it('abre o popover de link com a barra fixa e aplica o href', async () => {
    render(
      <PaginaRichTextEditor
        doc={{
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'abc' }] }],
        }}
        onChange={vi.fn()}
      />,
    );
    const textbox = screen.getByRole('textbox');
    await userEvent.click(textbox);
    await userEvent.keyboard('{Control>}a{/Control}');
    const toolbar = screen.getByRole('toolbar', { name: 'Formatação do texto' });
    await userEvent.click(
      screen.getAllByRole('button', { name: 'Link' }).find((b) => toolbar.contains(b))!,
    );
    const input = screen.getByLabelText('Endereço do link');
    await userEvent.type(input, 'https://mesaas.com.br');
    await userEvent.keyboard('{Enter}');
    expect(textbox.querySelector('a[href="https://mesaas.com.br"]')).not.toBeNull();
  });
});
