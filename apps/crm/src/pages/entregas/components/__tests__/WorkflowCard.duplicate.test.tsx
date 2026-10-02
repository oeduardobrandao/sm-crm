import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render as rtlRender, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('../../../../store', () => ({
  updateWorkflowEtapa: vi.fn(),
  getWorkflowEvents: vi.fn().mockResolvedValue([]),
}));

// Same convention as PostProcessCard.test: render the menu content
// unconditionally but keep onClick wired so the items are clickable.
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: (e: React.MouseEvent) => void;
  }) => (
    <button type="button" role="menuitem" onClick={onClick}>
      {children}
    </button>
  ),
}));

import { WorkflowCard } from '../WorkflowCard';
import type { BoardCard } from '../../hooks/useEntregasData';

function render(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return rtlRender(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

const etapas = [
  {
    id: 1,
    workflow_id: 1,
    ordem: 0,
    nome: 'Aprovação',
    status: 'concluido' as const,
    tipo: 'aprovacao_cliente' as const,
    prazo_dias: 3,
    tipo_prazo: 'corridos' as const,
  },
  {
    id: 2,
    workflow_id: 1,
    ordem: 1,
    nome: 'Design',
    status: 'ativo' as const,
    tipo: 'padrao' as const,
    prazo_dias: 5,
    tipo_prazo: 'corridos' as const,
  },
];

function makeCard(currentEtapaOrdem: number): BoardCard {
  const etapa = etapas.find((e) => e.ordem === currentEtapaOrdem)!;
  return {
    workflow: {
      id: 1,
      cliente_id: 1,
      titulo: 'Campanha',
      status: 'ativo',
      etapa_atual: currentEtapaOrdem,
      recorrente: false,
    },
    etapa,
    allEtapas: etapas,
    cliente: undefined,
    membro: undefined,
    deadline: { diasRestantes: 5, horasRestantes: 0, estourado: false, urgente: false },
    totalEtapas: etapas.length,
    etapaIdx: currentEtapaOrdem,
  } as unknown as BoardCard;
}

const card = makeCard(1);

describe('WorkflowCard: Duplicar fluxo', () => {
  it('mostra o item e chama onDuplicateClick sem abrir o card', () => {
    const onClick = vi.fn();
    const onDuplicateClick = vi.fn();
    render(
      <MemoryRouter>
        <WorkflowCard card={card} onClick={onClick} onDuplicateClick={onDuplicateClick} />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('menuitem', { name: /Duplicar fluxo/ }));
    expect(onDuplicateClick).toHaveBeenCalledTimes(1);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('sem onDuplicateClick não mostra o item', () => {
    render(
      <MemoryRouter>
        <WorkflowCard card={card} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('menuitem', { name: /Duplicar fluxo/ })).not.toBeInTheDocument();
  });
});
