import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { MentionChip } from '../MentionChip';
import type { MentionRef } from '../types';

function renderChip(mention: MentionRef) {
  return render(
    <MemoryRouter>
      <MentionChip mention={mention} />
    </MemoryRouter>,
  );
}

describe('MentionChip', () => {
  it('renders a membro mention as a link to /equipe/:id', () => {
    renderChip({ entityType: 'membro', id: 7, label: 'Ana' });
    const link = screen.getByRole('link', { name: /@Ana/ });
    expect(link).toHaveAttribute('href', '/equipe/7');
    expect(link.className).toContain('mention-chip');
    expect(link.className).toContain('mention-chip--membro');
  });

  it('renders a cliente mention as a link to /clientes/:id', () => {
    renderChip({ entityType: 'cliente', id: 12, label: 'Clínica X' });
    expect(screen.getByRole('link', { name: /@Clínica X/ })).toHaveAttribute(
      'href',
      '/clientes/12',
    );
  });

  it('renders a tarefa mention as a link to /tarefas?tarefa=:id', () => {
    renderChip({ entityType: 'tarefa', id: 3, label: 'Revisar copy' });
    expect(screen.getByRole('link', { name: /@Revisar copy/ })).toHaveAttribute(
      'href',
      '/tarefas?tarefa=3',
    );
  });

  it('renders a post mention with a parentId as a link to /entregas?drawer=:parentId', () => {
    renderChip({ entityType: 'post', id: 2, label: 'Post de lançamento', parentId: 42 });
    expect(screen.getByRole('link', { name: /@Post de lançamento/ })).toHaveAttribute(
      'href',
      '/entregas?drawer=42',
    );
  });

  it('renders a post mention without a parentId as an unlinked span', () => {
    renderChip({ entityType: 'post', id: 2, label: 'Post sem workflow' });
    expect(screen.queryByRole('link')).toBeNull();
    const span = screen.getByText(/@Post sem workflow/);
    expect(span.className).toContain('mention-chip');
    expect(span.className).toContain('mention-chip--post');
  });
});
