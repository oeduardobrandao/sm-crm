import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  queryState,
  chartCalls,
} = vi.hoisted(() => {
  const queryState: Record<string, { data?: unknown; isLoading?: boolean; error?: unknown }> = {};
  const chartCalls: Array<unknown[]> = [];

  return {
    queryState,
    chartCalls,
  };
});

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn((options: { queryKey: unknown[] }) => {
    const key = String(options.queryKey[0]);
    return queryState[key] ?? { data: undefined, isLoading: false, error: undefined };
  }),
}));

vi.mock('chart.js', () => {
  class ChartMock {
    static register = vi.fn();
    destroy = vi.fn();
    constructor(...args: unknown[]) {
      chartCalls.push(args);
    }
  }

  return { Chart: ChartMock, registerables: [] };
});

vi.mock('../../../store', () => ({
  getWorkflows: vi.fn(),
  getClientes: vi.fn(),
  getWorkflowTemplates: vi.fn(),
  getMembros: vi.fn(),
  getAllEtapasWithWorkflow: vi.fn(),
}));

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
}));

vi.mock('@/components/ui/spinner', () => ({
  Spinner: ({ size }: { size?: string }) => <div data-testid={`spinner-${size ?? 'md'}`}>Spinner</div>,
}));

vi.mock('@/components/ui/select', async () => {
  const ReactModule = await vi.importActual<typeof import('react')>('react');

  interface SelectContextValue {
    value?: string;
    onValueChange?: (value: string) => void;
  }

  const SelectContext = ReactModule.createContext<SelectContextValue>({});

  function Select({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    children: React.ReactNode;
  }) {
    return (
      <SelectContext.Provider value={{ value, onValueChange }}>
        <div>{children}</div>
      </SelectContext.Provider>
    );
  }

  const SelectTrigger = ReactModule.forwardRef<
    HTMLButtonElement,
    React.ButtonHTMLAttributes<HTMLButtonElement>
  >(({ children, type = 'button', ...props }, ref) => (
    <button ref={ref} type={type} {...props}>
      {children}
    </button>
  ));

  function SelectValue({ placeholder }: { placeholder?: string }) {
    const { value } = ReactModule.useContext(SelectContext);
    return <span>{value ?? placeholder ?? ''}</span>;
  }

  function SelectContent({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>;
  }

  function SelectItem({ value, children }: { value: string; children: React.ReactNode }) {
    const { onValueChange } = ReactModule.useContext(SelectContext);
    return (
      <button type="button" onClick={() => onValueChange?.(value)}>
        {children}
      </button>
    );
  }

  return {
    Select,
    SelectTrigger,
    SelectValue,
    SelectContent,
    SelectItem,
  };
});

import AnalyticsFluxosPage from '../AnalyticsFluxosPage';
import { getAllEtapasWithWorkflow, getClientes, getMembros, getWorkflowTemplates, getWorkflows } from '../../../store';

const mockedGetAllEtapasWithWorkflow = vi.mocked(getAllEtapasWithWorkflow);
const mockedGetWorkflows = vi.mocked(getWorkflows);
const mockedGetClientes = vi.mocked(getClientes);
const mockedGetWorkflowTemplates = vi.mocked(getWorkflowTemplates);
const mockedGetMembros = vi.mocked(getMembros);

function resetQueryState() {
  for (const key of Object.keys(queryState)) delete queryState[key];
}

function seedFluxosData() {
  queryState['all-etapas-workflow'] = {
    data: [
      {
        workflow_id: 1,
        nome: 'Roteiro',
        status: 'concluido',
        iniciado_em: '2026-04-10T00:00:00Z',
        concluido_em: '2026-04-12T00:00:00Z',
        prazo_dias: 3,
        tipo_prazo: 'corridos',
        responsavel_id: 7,
      },
      {
        workflow_id: 1,
        nome: 'Revisão',
        status: 'concluido',
        iniciado_em: '2026-04-12T00:00:00Z',
        concluido_em: '2026-04-15T00:00:00Z',
        prazo_dias: 2,
        tipo_prazo: 'corridos',
        responsavel_id: 7,
      },
    ],
  };
  queryState.workflows = {
    data: [
      {
        id: 1,
        cliente_id: 1,
        template_id: 10,
        created_at: '2026-04-10T00:00:00Z',
        status: 'concluido',
      },
      {
        id: 2,
        cliente_id: 2,
        template_id: 20,
        created_at: '2026-04-17T00:00:00Z',
        status: 'ativo',
      },
    ],
  };
  queryState.clientes = {
    data: [
      { id: 1, nome: 'Cliente A' },
      { id: 2, nome: 'Cliente B' },
    ],
  };
  queryState['workflow-templates'] = {
    data: [
      { id: 10, nome: 'Template A' },
      { id: 20, nome: 'Template B' },
    ],
  };
  queryState.membros = {
    data: [
      { id: 7, nome: 'Ana' },
    ],
  };
}

beforeEach(() => {
  resetQueryState();
  chartCalls.length = 0;
  mockedGetAllEtapasWithWorkflow.mockReset();
  mockedGetWorkflows.mockReset();
  mockedGetClientes.mockReset();
  mockedGetWorkflowTemplates.mockReset();
  mockedGetMembros.mockReset();

  mockedGetAllEtapasWithWorkflow.mockResolvedValue([]);
  mockedGetWorkflows.mockResolvedValue([]);
  mockedGetClientes.mockResolvedValue([]);
  mockedGetWorkflowTemplates.mockResolvedValue([]);
  mockedGetMembros.mockResolvedValue([]);
});

describe('AnalyticsFluxosPage', () => {
  it('shows the loading spinner while the workflow data is still loading', () => {
    queryState['all-etapas-workflow'] = { isLoading: true };

    render(<AnalyticsFluxosPage />);

    expect(screen.getByTestId('spinner-lg')).toBeTruthy();
  });

  it('shows the empty state when there are no workflows to analyze', () => {
    queryState['all-etapas-workflow'] = { data: [] };
    queryState.workflows = { data: [] };
    queryState.clientes = { data: [] };
    queryState['workflow-templates'] = { data: [] };
    queryState.membros = { data: [] };

    render(<AnalyticsFluxosPage />);

    expect(screen.getByText('Nenhum dado de fluxo encontrado. Crie fluxos de trabalho para começar a ver analytics.')).toBeTruthy();
  });

  it('renders the summary metrics and recomputes them when a filter changes', async () => {
    seedFluxosData();

    render(<AnalyticsFluxosPage />);

    await waitFor(() => {
      expect(chartCalls.length).toBeGreaterThan(0);
    });

    expect(screen.getByText('Analytics de Fluxos')).toBeTruthy();
    expect(screen.getByText('2 fluxos')).toBeTruthy();
    expect(screen.getByText('Tempo médio por etapa')).toBeTruthy();
    expect(screen.getAllByText('Ana').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Roteiro').length).toBeGreaterThan(0);

    const concludedCard = screen.getByText('CONCLUÍDOS').closest('.kpi-card');
    const activeCard = screen.getByText('ATIVOS').closest('.kpi-card');
    const onTimeCard = screen.getByText('PONTUALIDADE').closest('.kpi-card');

    expect(concludedCard).not.toBeNull();
    expect(activeCard).not.toBeNull();
    expect(onTimeCard).not.toBeNull();

    expect(within(concludedCard as HTMLElement).getByText('1')).toBeTruthy();
    expect(within(activeCard as HTMLElement).getByText('1')).toBeTruthy();
    expect(within(onTimeCard as HTMLElement).getByText('50%')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Cliente B' }));

    expect(within(concludedCard as HTMLElement).getByText('0')).toBeTruthy();
    expect(within(activeCard as HTMLElement).getByText('1')).toBeTruthy();
    expect(screen.getByText('Nenhuma etapa com responsável atribuído.')).toBeTruthy();
    expect(screen.getByText('Nenhuma etapa concluída ainda.')).toBeTruthy();
  });
});
