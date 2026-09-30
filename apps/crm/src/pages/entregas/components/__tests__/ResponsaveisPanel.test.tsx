import type { ComponentProps } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ResponsaveisPanel } from '../ResponsaveisPanel';
import type { Membro } from '../../../../store';

const membro = (id: number, nome: string) =>
  ({ id, nome, cargo: '', tipo: 'clt', custo_mensal: null, avatar_url: '' }) as Membro;
const membros = [membro(8, 'Bruno Lima'), membro(7, 'Ana Silva'), membro(9, 'Érica Souza')];

function renderPanel(props: Partial<ComponentProps<typeof ResponsaveisPanel>> = {}) {
  const onChange = vi.fn();
  const onClose = vi.fn();
  render(
    <ResponsaveisPanel
      membros={membros}
      counts={
        new Map([
          [7, 3],
          [8, 1],
        ])
      }
      selected={[]}
      onChange={onChange}
      caption="Responsável pela etapa atual"
      onClose={onClose}
      {...props}
    />,
  );
  return { onChange, onClose };
}

const countOf = (nome: string) =>
  within(screen.getByRole('checkbox', { name: nome }).closest('li')!).getByTestId(
    'responsavel-count',
  ).textContent;

describe('ResponsaveisPanel', () => {
  it('lista os membros em ordem alfabética (sem acento) com a contagem, 0 quando ausente', () => {
    renderPanel();
    expect(screen.getAllByRole('checkbox').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Ana Silva',
      'Bruno Lima',
      'Érica Souza',
    ]);
    expect(countOf('Ana Silva')).toBe('3');
    expect(countOf('Érica Souza')).toBe('0');
    expect(screen.getByText('Responsável pela etapa atual')).toBeInTheDocument();
  });

  it('marca e desmarca um membro na seleção', () => {
    const { onChange } = renderPanel({ selected: [8] });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ana Silva' }));
    expect(onChange).toHaveBeenLastCalledWith([8, 7]);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Bruno Lima' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('Limpar só aparece com seleção; o X fecha', () => {
    const first = renderPanel();
    expect(screen.queryByRole('button', { name: 'Limpar' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar painel de responsáveis' }));
    expect(first.onClose).toHaveBeenCalledTimes(1);
  });

  it('Limpar zera a seleção', () => {
    const { onChange } = renderPanel({ selected: [7] });
    fireEvent.click(screen.getByRole('button', { name: 'Limpar' }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
