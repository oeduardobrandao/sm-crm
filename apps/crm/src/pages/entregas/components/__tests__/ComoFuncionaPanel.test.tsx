import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase');
import { ComoFuncionaPanel } from '../ComoFuncionaPanel';

describe('ComoFuncionaPanel', () => {
  it('sem a flag descreve o fluxo como o card do kanban', () => {
    render(<ComoFuncionaPanel onDismiss={vi.fn()} />);
    expect(
      screen.getByText('um ciclo de entrega de um cliente — o card do kanban'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Post individual')).toBeNull();
  });
  it('com a flag inclui o post individual entre os objetos', () => {
    render(<ComoFuncionaPanel onDismiss={vi.fn()} postProcessesEnabled />);
    expect(screen.getByText('Post individual')).toBeInTheDocument();
    expect(
      screen.getByText('um ciclo de entrega de um cliente: um card do kanban'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('as fases do fluxo ou do post individual: só uma fica ativa por vez'),
    ).toBeInTheDocument();
  });
});
