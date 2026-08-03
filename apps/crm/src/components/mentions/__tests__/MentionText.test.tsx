import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { MentionText } from '../MentionText';

function renderText(text: string) {
  return render(
    <MemoryRouter>
      <p className="whitespace-pre-wrap">
        <MentionText text={text} />
      </p>
    </MemoryRouter>,
  );
}

describe('MentionText', () => {
  it('renders plain text with no mentions untouched', () => {
    renderText('Nada de especial aqui.');
    expect(screen.getByText('Nada de especial aqui.')).toBeInTheDocument();
  });

  it('renders a mention chip inline with surrounding text', () => {
    const { container } = renderText('Oi @[Ana](membro:1), tudo bem?');
    const link = screen.getByRole('link', { name: /@Ana/ });
    expect(link).toHaveAttribute('href', '/equipe/1');
    expect(container.textContent).toBe('Oi @Ana, tudo bem?');
  });

  it('renders multiple mentions mixed with text', () => {
    renderText('@[Ana](membro:1) e @[Bruno](membro:2) vão revisar @[Tarefa X](tarefa:9).');
    expect(screen.getByRole('link', { name: /@Ana/ })).toHaveAttribute('href', '/equipe/1');
    expect(screen.getByRole('link', { name: /@Bruno/ })).toHaveAttribute('href', '/equipe/2');
    expect(screen.getByRole('link', { name: /@Tarefa X/ })).toHaveAttribute(
      'href',
      '/tarefas?tarefa=9',
    );
  });

  it('renders an unlinked chip for a post mention without a parentId', () => {
    renderText('Veja @[Post sem workflow](post:2)');
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText(/@Post sem workflow/)).toBeInTheDocument();
  });

  it('does not wrap output in an extra block element', () => {
    const { container } = renderText('Oi @[Ana](membro:1)');
    const p = container.querySelector('p');
    expect(p).not.toBeNull();
    // MentionText itself renders a fragment: only the chip's own <a>/<span> tags
    // should appear as element children of the host <p>, no wrapper div/p.
    expect(p!.querySelector('div')).toBeNull();
  });
});
