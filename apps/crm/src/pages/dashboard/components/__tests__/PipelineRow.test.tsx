import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { PipelineRow } from '../PipelineRow';

describe('PipelineRow', () => {
  it('shows scheduled and production counts', () => {
    render(<PipelineRow pipeline={{ agendados: 2, em_producao: 1, agente: 0, falha: 0 }} />);
    expect(screen.getByText(/2 agendados/)).toBeTruthy();
    expect(screen.getByText(/1 em produção/)).toBeTruthy();
  });

  it('shows "Pipeline parado" when nothing queued or in production', () => {
    render(<PipelineRow pipeline={{ agendados: 0, em_producao: 0, agente: 0, falha: 0 }} />);
    expect(screen.getByText(/Pipeline parado/)).toBeTruthy();
  });

  it('shows the agent indicator when agent posts exist', () => {
    render(<PipelineRow pipeline={{ agendados: 1, em_producao: 0, agente: 1, falha: 0 }} />);
    expect(screen.getByText(/1 por agente/)).toBeTruthy();
  });

  it('shows the falha flag when failures exist', () => {
    render(<PipelineRow pipeline={{ agendados: 0, em_producao: 0, agente: 0, falha: 2 }} />);
    expect(screen.getByText(/2 falha/)).toBeTruthy();
  });
});
