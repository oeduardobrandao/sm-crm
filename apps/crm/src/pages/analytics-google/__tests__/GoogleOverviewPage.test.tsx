import { Children, isValidElement, type ReactNode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { portfolio, registerGoogleI18n, review, unit } from './fixtures';

const limits = vi.hoisted(() => ({
  value: {
    features: { feature_google_business: true } as Record<string, boolean> | null,
    isLoading: false,
  },
}));

vi.mock('../../../hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => limits.value,
}));

// These cases cover the desktop layout; GoogleOverviewPage.phone.test.tsx covers the phone one.
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));

// A native <select> stands in for Radix: the trigger's aria-label names it.
vi.mock('@/components/ui/select', () => {
  const textOf = (node: ReactNode): string =>
    Children.toArray(node)
      .map((c) =>
        typeof c === 'string' || typeof c === 'number'
          ? String(c)
          : isValidElement(c)
            ? textOf((c.props as { children?: ReactNode }).children)
            : '',
      )
      .join('')
      .trim();
  function SelectItem() {
    return null;
  }
  function SelectContent() {
    return null;
  }
  function SelectTrigger() {
    return null;
  }
  function SelectValue() {
    return null;
  }
  function collect(children: ReactNode, out: { label?: string; items: [string, string][] }) {
    Children.forEach(children, (child) => {
      if (!isValidElement(child)) return;
      const props = child.props as Record<string, unknown>;
      if (child.type === SelectItem) {
        out.items.push([String(props.value), textOf(props.children as ReactNode)]);
      } else if (child.type === SelectTrigger) {
        out.label = props['aria-label'] as string | undefined;
      } else if (props.children) {
        collect(props.children as ReactNode, out);
      }
    });
    return out;
  }
  function Select({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    children: ReactNode;
  }) {
    const { label, items } = collect(children, { items: [] });
    return (
      <select aria-label={label} value={value} onChange={(e) => onValueChange(e.target.value)}>
        {items.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    );
  }
  return { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };
});

vi.mock('../../../services/gbpAnalytics', () => ({ getGbpPortfolio: vi.fn() }));

vi.mock('../../../utils/security', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/security')>();
  return { ...actual, sanitizeUrl: vi.fn(actual.sanitizeUrl) };
});

import { getGbpPortfolio } from '../../../services/gbpAnalytics';
import { sanitizeUrl } from '../../../utils/security';
import GoogleOverviewPage from '../GoogleOverviewPage';

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/analytics/google']}>
        <Routes>
          <Route path="/analytics/google" element={<GoogleOverviewPage />} />
          <Route path="/analytics" element={<div data-testid="analytics-home" />} />
          <Route path="/analytics/:id/google" element={<div data-testid="client-google-tab" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const kpi = (label: string) =>
  screen.getByText(label, { selector: '.kpi-label' }).closest('.kpi-card') as HTMLElement;

const heading = () =>
  screen.findByRole('heading', { level: 1, name: 'Analytics do Google Meu Negócio' });

describe('GoogleOverviewPage', () => {
  beforeAll(registerGoogleI18n);

  beforeEach(() => {
    vi.clearAllMocks();
    limits.value = { features: { feature_google_business: true }, isLoading: false };
    vi.mocked(getGbpPortfolio).mockResolvedValue(portfolio());
  });

  it('renders the skeleton and fetches nothing while the plan loads', () => {
    limits.value = { features: null, isLoading: true };
    renderPage();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(getGbpPortfolio).not.toHaveBeenCalled();
  });

  it('redirects to /analytics without the Google Meu Negócio flag', async () => {
    limits.value = { features: { feature_google_business: false }, isLoading: false };
    renderPage();
    expect(await screen.findByTestId('analytics-home')).toBeInTheDocument();
    expect(getGbpPortfolio).not.toHaveBeenCalled();
  });

  it('asks for the default 30-day window of every client', async () => {
    renderPage();
    await heading();
    expect(getGbpPortfolio).toHaveBeenCalledWith(30);
  });

  it('renders the five KPI cards', async () => {
    vi.mocked(getGbpPortfolio).mockResolvedValue(
      portfolio({
        units: [
          unit('a', { title: 'Ativa' }),
          unit('b', { title: 'Revogada 1', status: 'revoked' }),
          unit('c', { title: 'Revogada 2', status: 'revoked' }),
        ],
      }),
    );
    renderPage();
    await heading();
    expect(within(kpi('Unidades')).getByText('3')).toBeInTheDocument();
    expect(within(kpi('Unidades')).getByText('2 precisam reconectar')).toBeInTheDocument();
    expect(within(kpi('Visualizações do perfil')).getByText('2.000')).toBeInTheDocument();
    expect(within(kpi('Ações')).getByText('85')).toBeInTheDocument();
    expect(within(kpi('Nota média')).getByText('4,7')).toBeInTheDocument();
    expect(within(kpi('Avaliações novas')).getByText('8')).toBeInTheDocument();
  });

  it('renders the highlights of the period', async () => {
    renderPage();
    const section = await screen.findByRole('region', { name: 'Destaques do período' });
    expect(within(section).getByText('Mais ações')).toBeInTheDocument();
    expect(within(section).getByText('Maior crescimento')).toBeInTheDocument();
    // Beta grew 100%, Alfa 20%.
    expect(within(section).getAllByText('Beta Centro').length).toBeGreaterThan(0);
    expect(within(section).getAllByText('Alfa Moema').length).toBeGreaterThan(0);
  });

  it('shows at most 10 reviews and "Ver todas" reveals the rest', async () => {
    vi.mocked(getGbpPortfolio).mockResolvedValue(
      portfolio({ reviewsAttention: Array.from({ length: 12 }, (_, i) => review(i)) }),
    );
    const { container } = renderPage();
    await heading();
    expect(container.querySelectorAll('[data-attention-review]')).toHaveLength(10);
    fireEvent.click(screen.getByRole('button', { name: 'Ver todas (12)' }));
    expect(container.querySelectorAll('[data-attention-review]')).toHaveLength(12);
  });

  it('says the reviews come from the most recent stored ones', async () => {
    renderPage();
    expect(
      await screen.findByText(/nas avaliações mais recentes de cada unidade/),
    ).toBeInTheDocument();
  });

  it('"Ver no Google" goes through sanitizeUrl and is absent without a maps URI', async () => {
    vi.mocked(getGbpPortfolio).mockResolvedValue(
      portfolio({
        reviewsAttention: [
          review(0, { reviewerName: 'Com link', mapsUri: 'https://maps.google.com/?cid=9' }),
          review(1, { reviewerName: 'Sem link', mapsUri: null }),
          review(2, { reviewerName: 'Link ruim', mapsUri: 'javascript:alert(1)' }),
        ],
      }),
    );
    const { container } = renderPage();
    await heading();
    const rows = [...container.querySelectorAll<HTMLElement>('[data-attention-review]')];
    expect(within(rows[0]).getByRole('link', { name: 'Ver no Google' })).toHaveAttribute(
      'href',
      'https://maps.google.com/?cid=9',
    );
    expect(within(rows[1]).queryByRole('link', { name: 'Ver no Google' })).toBeNull();
    expect(within(rows[2]).queryByRole('link', { name: 'Ver no Google' })).toBeNull();
    expect(sanitizeUrl).toHaveBeenCalledWith('https://maps.google.com/?cid=9');
    expect(sanitizeUrl).toHaveBeenCalledWith('javascript:alert(1)');
  });

  it('lists the units that need attention with a link to reconnect', async () => {
    vi.mocked(getGbpPortfolio).mockResolvedValue(
      portfolio({
        units: [
          unit('a', { title: 'Fresca' }),
          unit('b', {
            title: 'Parada',
            stale: true,
            lastSyncedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
          }),
          unit('c', { title: 'Revogada', clientId: 7, status: 'revoked' }),
        ],
      }),
    );
    renderPage();
    const section = await screen.findByRole('region', { name: 'Unidades que precisam de atenção' });
    expect(within(section).getByText('Acesso revogado no Google')).toBeInTheDocument();
    expect(within(section).getByRole('link', { name: /Reconectar/ })).toHaveAttribute(
      'href',
      '/clientes/7/redes-sociais?rede=google',
    );
    expect(within(section).getByText('Desatualizada')).toBeInTheDocument();
    expect(within(section).getByText('Última sincronização há 3 dias')).toBeInTheDocument();
    expect(within(section).queryByText('Fresca')).toBeNull();
  });

  it('hides the attention section when every unit is fresh', async () => {
    renderPage();
    await heading();
    expect(screen.queryByRole('region', { name: 'Unidades que precisam de atenção' })).toBeNull();
  });

  it('lists every unit sorted by views and a row opens the client tab', async () => {
    renderPage();
    await heading();
    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('Alfa Moema')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Clínica Alfa')).toBeInTheDocument();
    expect(within(rows[0]).getByText('1.200')).toBeInTheDocument();
    expect(within(rows[0]).getByText('+20%')).toBeInTheDocument();
    fireEvent.click(rows[1]);
    expect(await screen.findByTestId('client-google-tab')).toBeInTheDocument();
  });

  it('sorts the units table from a header button', async () => {
    renderPage();
    await heading();
    const table = screen.getByRole('table');
    const firstUnit = () => within(within(table).getAllByRole('row')[1]).getAllByRole('link')[0];
    expect(firstUnit()).toHaveTextContent('Alfa Moema');
    const viewsButton = within(table).getByRole('button', { name: 'Visualizações' });
    expect(viewsButton.closest('th')).toHaveAttribute('aria-sort', 'descending');
    fireEvent.click(viewsButton);
    expect(firstUnit()).toHaveTextContent('Beta Centro');
    expect(viewsButton.closest('th')).toHaveAttribute('aria-sort', 'ascending');
  });

  it('a revoked unit shows "Reconectar" in Atualizado', async () => {
    vi.mocked(getGbpPortfolio).mockResolvedValue(
      portfolio({ units: [unit('a', { title: 'Revogada', status: 'revoked' })] }),
    );
    renderPage();
    await heading();
    const row = within(screen.getByRole('table')).getAllByRole('row')[1];
    expect(within(row).getByText('Reconectar')).toBeInTheDocument();
  });

  it('hides the specialty comparison without a group of 2+ units', async () => {
    vi.mocked(getGbpPortfolio).mockResolvedValue(
      portfolio({
        units: [
          unit('a', { especialidade: 'Odontologia' }),
          unit('b', { especialidade: 'Dermatologia' }),
        ],
      }),
    );
    renderPage();
    await heading();
    expect(screen.queryByText('Comparativo por especialidade')).toBeNull();
  });

  it('shows the specialty comparison for a group of 2+ units', async () => {
    vi.mocked(getGbpPortfolio).mockResolvedValue(
      portfolio({
        units: [
          unit('a', { especialidade: 'Odontologia' }),
          unit('b', { especialidade: 'Odontologia' }),
        ],
      }),
    );
    renderPage();
    expect(await screen.findByText('Comparativo por especialidade')).toBeInTheDocument();
    expect(screen.getByText('Odontologia')).toBeInTheDocument();
  });

  it('the client filter asks the server for that client and keeps every option', async () => {
    renderPage();
    await heading();
    // The options come from the loaded units: the heading renders first, so wait for option 2
    // or the change lands on a select that has no such value yet.
    await screen.findByRole('option', { name: 'Odonto Beta' });
    const select = screen.getByRole('combobox', { name: 'Cliente' });
    fireEvent.change(select, { target: { value: '2' } });
    await waitFor(() => expect(getGbpPortfolio).toHaveBeenCalledWith(30, 2));
    const options = within(screen.getByRole('combobox', { name: 'Cliente' }))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toEqual(['Todos os clientes', 'Clínica Alfa', 'Odonto Beta']);
  });

  it('offers 7, 30 and 90 days', async () => {
    renderPage();
    await heading();
    const select = screen.getByRole('combobox', { name: 'Período' });
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['7 dias', '30 dias', '90 dias']);
    fireEvent.change(select, { target: { value: '7' } });
    await waitFor(() => expect(getGbpPortfolio).toHaveBeenCalledWith(7));
  });

  it('shows the empty state when no unit is connected', async () => {
    vi.mocked(getGbpPortfolio).mockResolvedValue(portfolio({ units: [], reviewsAttention: [] }));
    renderPage();
    expect(await screen.findByText('Nenhum perfil conectado')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir para clientes' })).toHaveAttribute(
      'href',
      '/clientes',
    );
  });

  it('shows an error with a retry', async () => {
    vi.mocked(getGbpPortfolio).mockRejectedValueOnce(new Error('Error 500'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível carregar os dados do Google Meu Negócio.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await heading()).toBeInTheDocument();
  });
});
