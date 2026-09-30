import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// Radix Select não abre em jsdom: o mesmo <select> nativo de NovaIdeiaDialog.test.tsx.
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    children: React.ReactNode;
  }) => (
    <select aria-label="Agrupar por" value={value} onChange={(e) => onValueChange(e.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

import { ListToolbar } from '../ListToolbar';

const ALL = ['prazo', 'postagem', 'cliente', 'responsavel', 'etapa', 'nenhum'] as const;

describe('ListToolbar', () => {
  it('oferece os agrupamentos recebidos com rótulos em português e avisa a troca', () => {
    const onGroupByChange = vi.fn();
    render(
      <ListToolbar
        groupBy="prazo"
        groupByOptions={ALL}
        onGroupByChange={onGroupByChange}
        responsaveisOpen={false}
        onToggleResponsaveis={vi.fn()}
        selectedResponsaveis={0}
      />,
    );
    const select = screen.getByRole('combobox', { name: 'Agrupar por' }) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      'Prazo da etapa',
      'Data de postagem',
      'Cliente',
      'Responsável',
      'Etapa',
      'Nenhum',
    ]);
    fireEvent.change(select, { target: { value: 'cliente' } });
    expect(onGroupByChange).toHaveBeenCalledWith('cliente');
  });

  it('só oferece o que a página passar (sem Data de postagem na Lista de Fluxos)', () => {
    render(
      <ListToolbar
        groupBy="prazo"
        groupByOptions={ALL.filter((g) => g !== 'postagem')}
        onGroupByChange={vi.fn()}
        responsaveisOpen={false}
        onToggleResponsaveis={vi.fn()}
        selectedResponsaveis={0}
      />,
    );
    const select = screen.getByRole('combobox', { name: 'Agrupar por' }) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).not.toContain('postagem');
  });

  it('alterna o painel Responsáveis e mostra quantos estão marcados', () => {
    const onToggle = vi.fn();
    render(
      <ListToolbar
        groupBy="prazo"
        groupByOptions={ALL}
        onGroupByChange={vi.fn()}
        responsaveisOpen
        onToggleResponsaveis={onToggle}
        selectedResponsaveis={2}
      />,
    );
    const button = screen.getByRole('button', { name: /Responsáveis/ });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveTextContent('2');
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
