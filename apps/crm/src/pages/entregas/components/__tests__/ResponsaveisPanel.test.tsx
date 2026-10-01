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

  it('a contagem é a descrição do checkbox e o nome continua sendo o do membro', () => {
    renderPanel();
    const ana = screen.getByRole('checkbox', { name: 'Ana Silva' });
    expect(ana).toHaveAccessibleName('Ana Silva');
    expect(ana).toHaveAccessibleDescription('3');
    expect(screen.getByRole('checkbox', { name: 'Bruno Lima' })).toHaveAccessibleDescription('1');
    // Ausente do mapa = 0, lido como 0 (não como "sem descrição").
    expect(screen.getByRole('checkbox', { name: 'Érica Souza' })).toHaveAccessibleDescription('0');
  });

  it('dois painéis na mesma página não trocam as contagens entre si', () => {
    const props = { membros, selected: [], onChange: vi.fn(), caption: 'Legenda' };
    render(
      <>
        <ResponsaveisPanel {...props} counts={new Map([[7, 3]])} />
        <ResponsaveisPanel {...props} counts={new Map([[7, 5]])} />
      </>,
    );
    const [primeiro, segundo] = screen.getAllByRole('checkbox', { name: 'Ana Silva' });
    // Ids repetidos fariam o segundo checkbox ler a contagem do primeiro.
    expect(primeiro).toHaveAccessibleDescription('3');
    expect(segundo).toHaveAccessibleDescription('5');
  });

  it('o X não fixa fundo nem borda inline, senão o hover dele nunca pinta', () => {
    renderPanel();
    const x = screen.getByRole('button', { name: 'Fechar painel de responsáveis' });
    expect(x.style.background).toBe('');
    expect(x.style.border).toBe('');
  });
});
