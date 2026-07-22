import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { SortableEtapaList, defaultEtapa, type EtapaFormData } from '../SortableEtapaList';

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
