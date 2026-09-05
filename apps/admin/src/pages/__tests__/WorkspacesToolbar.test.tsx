import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Plan } from '../../lib/api';
import { WorkspacesFilterChips } from '../workspaces/WorkspacesFilterChips';
import { WorkspacesToolbar } from '../workspaces/WorkspacesToolbar';
import { DEFAULT_COLUMN_PREFS } from '../workspaces-columns';
import { DEFAULT_PARAMS } from '../workspaces-params';

const PLANS = [
  { id: 'pro', name: 'Pro' },
  { id: 'max', name: 'Max' },
] as unknown as Plan[];

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('WorkspacesToolbar', () => {
  it('debounces the search box into one onChange({ q })', () => {
    const onChange = vi.fn();
    render(
      <WorkspacesToolbar
        params={DEFAULT_PARAMS}
        plans={PLANS}
        prefs={DEFAULT_COLUMN_PREFS}
        onChange={onChange}
        onPrefs={vi.fn()}
        onExport={vi.fn()}
        exporting={false}
      />,
    );
    const input = screen.getByPlaceholderText('Buscar por nome ou e-mail do dono…');
    fireEvent.change(input, { target: { value: 'a' } });
    fireEvent.change(input, { target: { value: 'ag' } });
    expect(onChange).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(300));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ q: 'ag' });
  });

  it('shows the current filter values and the export state', () => {
    render(
      <WorkspacesToolbar
        params={{ ...DEFAULT_PARAMS, status: 'pendente', atividade: 'dormente' }}
        plans={PLANS}
        prefs={DEFAULT_COLUMN_PREFS}
        onChange={vi.fn()}
        onPrefs={vi.fn()}
        onExport={vi.fn()}
        exporting={true}
      />,
    );
    expect(screen.getByText('Pagamento pendente')).toBeInTheDocument();
    expect(screen.getByText('Dormente (30d+)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Exportando…/ })).toBeDisabled();
  });
});

describe('WorkspacesFilterChips', () => {
  it('renders nothing without active filters', () => {
    const { container } = render(
      <WorkspacesFilterChips
        params={DEFAULT_PARAMS}
        plans={PLANS}
        total={143}
        onChange={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders one chip per active filter, removes a filter, clears all, shows the count', () => {
    const onChange = vi.fn();
    const onClear = vi.fn();
    render(
      <WorkspacesFilterChips
        params={{ ...DEFAULT_PARAMS, q: 'norte', plano: 'pro', status: 'pendente' }}
        plans={PLANS}
        total={7}
        onChange={onChange}
        onClear={onClear}
      />,
    );
    expect(screen.getByText(/Busca:/).textContent).toContain('norte');
    expect(screen.getByText(/Plano:/).textContent).toContain('Pro');
    expect(screen.getByText(/Status:/).textContent).toContain('Pagamento pendente');
    expect(screen.getByText('7 resultados')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remover filtro Status' }));
    expect(onChange).toHaveBeenCalledWith({ status: '' });

    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
