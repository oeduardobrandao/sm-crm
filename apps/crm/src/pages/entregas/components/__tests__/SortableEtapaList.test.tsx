import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import {
  SortableEtapaList,
  defaultEtapa,
  findEmptyEtapa,
  type EtapaFormData,
} from '../SortableEtapaList';

// jsdom has no scrollIntoView; adding an etapa scrolls the new row into view.
(Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};

// membros=[] renders EmptyStateGuide, which uses react-router-dom's <Link> —
// wrap every render in MemoryRouter, matching WorkflowModals.test.tsx's convention.
function Harness({ initial }: { initial: EtapaFormData[] }) {
  const [etapas, setEtapas] = useState(initial);
  return (
    <SortableEtapaList etapas={etapas} setEtapas={setEtapas} modoPrazo="padrao" membros={[]} />
  );
}

describe('SortableEtapaList', () => {
  it('toggles aprovação externa via the pill and shows the portal note', () => {
    render(
      <MemoryRouter>
        <Harness initial={[defaultEtapa({ nome: 'Design' })]} />
      </MemoryRouter>,
    );
    // The dnd-kit sortable wrapper also gets role="button" (via spread `attributes`),
    // and its computed accessible name includes the row's full text content — so the
    // query must disambiguate to the actual pill via the aria-pressed attribute.
    const pill = screen
      .getAllByRole('button', { name: /aprovação externa/i })
      .find((el) => el.hasAttribute('aria-pressed'))!;
    expect(pill.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(pill);
    expect(pill.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/portal do cliente/i)).toBeTruthy();
  });

  it('allows multiple approval rows', () => {
    render(
      <MemoryRouter>
        <Harness
          initial={[
            defaultEtapa({ nome: 'Aprovação do texto', tipo: 'aprovacao_cliente' }),
            defaultEtapa({ nome: 'Aprovação da arte', tipo: 'aprovacao_cliente' }),
          ]}
        />
      </MemoryRouter>,
    );
    const pills = screen.getAllByRole('button', { name: /aprovação externa/i });
    expect(pills.filter((p) => p.getAttribute('aria-pressed') === 'true')).toHaveLength(2);
  });

  it('shows the count in the heading and numbers the rows', () => {
    render(
      <MemoryRouter>
        <Harness initial={[defaultEtapa({ nome: 'Design' }), defaultEtapa({ nome: 'Revisão' })]} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Etapas · 2')).toBeTruthy();
    expect(screen.getByText('1.')).toBeTruthy();
    expect(screen.getByText('2.')).toBeTruthy();
  });

  it('shows a bare heading when the list is empty', () => {
    render(
      <MemoryRouter>
        <Harness initial={[]} />
      </MemoryRouter>,
    );
    expect(screen.getByText('Etapas')).toBeTruthy();
  });

  it('Adicionar Etapa re-focuses an existing empty row instead of stacking another', () => {
    render(
      <MemoryRouter>
        <Harness initial={[defaultEtapa({ nome: 'Design' })]} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText(/adicionar etapa/i));
    expect(screen.getAllByPlaceholderText('Nome da etapa')).toHaveLength(2);
    fireEvent.click(screen.getByText(/adicionar etapa/i));
    const inputs = screen.getAllByPlaceholderText('Nome da etapa') as HTMLInputElement[];
    expect(inputs).toHaveLength(2); // guard held: still one empty row
    expect(document.activeElement).toBe(inputs[1]);
    fireEvent.change(inputs[1], { target: { value: 'Extra' } });
    fireEvent.click(screen.getByText(/adicionar etapa/i));
    expect(screen.getAllByPlaceholderText('Nome da etapa')).toHaveLength(3);
  });

  it('renders a row error when provided', () => {
    const row = defaultEtapa({ nome: 'Criação' });
    render(
      <MemoryRouter>
        <SortableEtapaList
          etapas={[row]}
          setEtapas={() => {}}
          modoPrazo="padrao"
          membros={[]}
          rowErrors={new Map([[row._id, 'Responsável não existe mais — selecione outro']])}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText(/não existe mais/i)).toBeTruthy();
  });
});

describe('findEmptyEtapa', () => {
  it('returns undefined for an empty list', () => {
    expect(findEmptyEtapa([])).toBeUndefined();
  });

  it('ignores suggestion-bound rows even when their name is blank', () => {
    const blanked = defaultEtapa({ nome: '', suggestionId: 'criacao' });
    expect(findEmptyEtapa([blanked])).toBeUndefined();
  });

  it('finds a custom row whose name was cleared back to blank', () => {
    const cleared = defaultEtapa({ nome: '   ' });
    expect(findEmptyEtapa([defaultEtapa({ nome: 'Design' }), cleared])).toBe(cleared);
  });

  it('returns the first of several empty rows', () => {
    const first = defaultEtapa();
    const second = defaultEtapa();
    expect(findEmptyEtapa([first, second])).toBe(first);
  });
});
