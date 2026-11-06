import { createRef } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ListToolbar } from '../ListToolbar';

// jsdom's matchMedia reports false, so ListToolbar renders its phone chips here.

const ALL = ['prazo', 'postagem', 'cliente', 'responsavel', 'etapa', 'nenhum'] as const;

function renderToolbar(props: Partial<Parameters<typeof ListToolbar>[0]> = {}) {
  const handlers = {
    onGroupByChange: vi.fn(),
    onToggleResponsaveis: vi.fn(),
  };
  render(
    <MemoryRouter>
      <ListToolbar
        groupBy="prazo"
        groupByOptions={ALL}
        responsaveisOpen={false}
        selectedResponsaveis={0}
        {...handlers}
        {...props}
      />
    </MemoryRouter>,
  );
  return handlers;
}

describe('ListToolbar no celular', () => {
  it('mostra os chips do mockup em vez do select', () => {
    renderToolbar({ selectedResponsaveis: 2 });
    expect(screen.queryByRole('combobox')).toBeNull();
    const row = screen.getByRole('group', { name: 'Opções da lista' });
    expect(
      within(row).getByRole('button', { name: 'Agrupar por: Prazo da etapa' }),
    ).toHaveTextContent('Agrupar: Prazo');
    expect(within(row).getByRole('button', { name: /Responsáveis/ })).toHaveTextContent(
      'Responsáveis2',
    );
    expect(within(row).queryByRole('button', { name: /Mostrar postados/ })).toBeNull();
  });

  it('Agrupar abre a lista de agrupamentos, marca o atual e avisa a troca', () => {
    const { onGroupByChange } = renderToolbar({ groupByOptions: ['prazo', 'cliente', 'nenhum'] });
    fireEvent.click(screen.getByRole('button', { name: 'Agrupar por: Prazo da etapa' }));
    const sheet = screen.getByRole('dialog', { name: 'Agrupar por' });
    expect(
      within(sheet).getByRole('button', { name: 'Prazo da etapa (atual)' }),
    ).toBeInTheDocument();
    expect(within(sheet).queryByRole('button', { name: 'Data de postagem' })).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cliente' }));
    expect(onGroupByChange).toHaveBeenCalledWith('cliente');
  });

  it('Responsáveis alterna o painel, reflete aria-expanded e recebe o ref', () => {
    const ref = createRef<HTMLButtonElement>();
    const { onToggleResponsaveis } = renderToolbar({
      responsaveisOpen: true,
      responsaveisToggleRef: ref,
    });
    const btn = screen.getByRole('button', { name: /Responsáveis/ });
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    expect(ref.current).toBe(btn);
    fireEvent.click(btn);
    expect(onToggleResponsaveis).toHaveBeenCalledTimes(1);
  });

  it('Mostrar postados é um chip de alternar com a contagem', () => {
    const onToggle = vi.fn();
    renderToolbar({ postados: { count: 3, shown: false, onToggle } });
    const chip = screen.getByRole('button', { name: /Mostrar postados/ });
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    expect(chip).toHaveTextContent('3');
    fireEvent.click(chip);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
