import { createRef } from 'react';
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

  it('entrega o botão Responsáveis pela ref, para a página devolver o foco a ele', () => {
    const ref = createRef<HTMLButtonElement>();
    render(
      <ListToolbar
        groupBy="prazo"
        groupByOptions={ALL}
        onGroupByChange={vi.fn()}
        responsaveisOpen={false}
        onToggleResponsaveis={vi.fn()}
        selectedResponsaveis={0}
        responsaveisToggleRef={ref}
      />,
    );
    expect(ref.current).toBe(screen.getByRole('button', { name: /Responsáveis/ }));
  });

  describe('postados (Lista de Publicações)', () => {
    const base = {
      groupBy: 'prazo' as const,
      groupByOptions: ALL,
      onGroupByChange: vi.fn(),
      responsaveisOpen: false,
      onToggleResponsaveis: vi.fn(),
      selectedResponsaveis: 0,
    };

    it('sem a prop postados (Lista de Fluxos) não mostra o botão', () => {
      render(<ListToolbar {...base} />);
      expect(screen.queryByRole('button', { name: /postados/i })).toBeNull();
    });

    it('alterna os postados com aria-pressed e mostra quantos há', () => {
      const onToggle = vi.fn();
      const { rerender } = render(
        <ListToolbar {...base} postados={{ count: 3, shown: false, onToggle }} />,
      );
      const button = screen.getByRole('button', { name: /Mostrar postados/ });
      expect(button).toHaveAttribute('aria-pressed', 'false');
      expect(button).toHaveTextContent('3');
      fireEvent.click(button);
      expect(onToggle).toHaveBeenCalledTimes(1);

      rerender(<ListToolbar {...base} postados={{ count: 3, shown: true, onToggle }} />);
      expect(screen.getByRole('button', { name: /Mostrar postados/ })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });

    it('fica antes de Responsáveis, que segue por último sobre o painel; sem selo com 0', () => {
      render(<ListToolbar {...base} postados={{ count: 0, shown: false, onToggle: vi.fn() }} />);
      const postados = screen.getByRole('button', { name: /Mostrar postados/ });
      const responsaveis = screen.getByRole('button', { name: /Responsáveis/ });
      expect(
        postados.compareDocumentPosition(responsaveis) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(postados).not.toHaveTextContent(/\d/);
    });
  });
});
