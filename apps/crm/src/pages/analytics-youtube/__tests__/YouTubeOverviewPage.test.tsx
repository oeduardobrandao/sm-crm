import { Children, isValidElement, type ReactNode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { channels, registerYouTubeI18n } from './fixtures';

const limits = vi.hoisted(() => ({
  value: {
    features: { feature_youtube: true } as Record<string, boolean> | null,
    isLoading: false,
  },
}));

vi.mock('../../../hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => limits.value,
}));

// These cases cover the desktop layout; YouTubeOverviewPage.phone.test.tsx covers the phone one.
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

vi.mock('../../../services/youtubeAnalytics', () => ({ getYouTubePortfolio: vi.fn() }));

import { getYouTubePortfolio } from '../../../services/youtubeAnalytics';
import YouTubeOverviewPage from '../YouTubeOverviewPage';

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/analytics/youtube']}>
        <Routes>
          <Route path="/analytics/youtube" element={<YouTubeOverviewPage />} />
          <Route path="/analytics/:id/youtube" element={<div data-testid="channel-page" />} />
          <Route path="/analytics" element={<div data-testid="analytics-home" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const rowOf = (name: string) =>
  within(screen.getByRole('table')).getByRole('link', { name }).closest('tr') as HTMLElement;

describe('YouTubeOverviewPage', () => {
  beforeAll(registerYouTubeI18n);

  beforeEach(() => {
    vi.clearAllMocks();
    limits.value = { features: { feature_youtube: true }, isLoading: false };
    vi.mocked(getYouTubePortfolio).mockResolvedValue(channels());
  });

  it('renders the skeleton while the plan loads and never fetches', () => {
    limits.value = { features: null, isLoading: true };
    renderPage();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByTestId('analytics-home')).toBeNull();
    expect(getYouTubePortfolio).not.toHaveBeenCalled();
  });

  it('redirects to /analytics without feature_youtube and never fetches', () => {
    limits.value = { features: { feature_youtube: false }, isLoading: false };
    renderPage();
    expect(screen.getByTestId('analytics-home')).toBeInTheDocument();
    expect(getYouTubePortfolio).not.toHaveBeenCalled();
  });

  it('redirects while the plan has no features (fail closed)', () => {
    limits.value = { features: null, isLoading: false };
    renderPage();
    expect(screen.getByTestId('analytics-home')).toBeInTheDocument();
    expect(getYouTubePortfolio).not.toHaveBeenCalled();
  });

  it('renders one row per channel with its own formatted numbers', async () => {
    renderPage();
    await screen.findByRole('table');
    expect(getYouTubePortfolio).toHaveBeenCalledWith(28);
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(4); // head + 3

    const ana = rowOf('Dra. Ana Lima');
    expect(within(ana).getByText('Ana Lima')).toBeInTheDocument();
    expect(within(ana).getByText('48.310')).toBeInTheDocument();
    expect(within(ana).getByText('+1.204')).toBeInTheDocument();
    expect(within(ana).getByText('212.480')).toBeInTheDocument();
    expect(within(ana).getByText('6.912')).toBeInTheDocument();
    expect(within(ana).getByText('71%')).toBeInTheDocument();
    expect(within(ana).getByText('0:42')).toBeInTheDocument();
    expect(within(ana).getByText(/há/)).toBeInTheDocument();

    const odonto = rowOf('Odonto Sorriso Oficial');
    expect(within(odonto).getByText('-36')).toBeInTheDocument();
    expect(within(odonto).getByText('5:58')).toBeInTheDocument();
    // No content-type data for the window: the Shorts cell is a dash, never 0%.
    expect(within(odonto).queryByText('0%')).toBeNull();
  });

  it('default sort is views, highest first', async () => {
    renderPage();
    await screen.findByRole('table');
    const titles = within(screen.getByRole('table'))
      .getAllByRole('link')
      .map((a) => a.textContent);
    expect(titles).toEqual(['Dra. Ana Lima', 'Odonto Sorriso Oficial', 'Studio Bella']);
  });

  it('sorting a column header flips the order', async () => {
    renderPage();
    await screen.findByRole('table');
    const head = screen.getByRole('columnheader', { name: /^Visualizações/ });
    expect(head).toHaveAttribute('aria-sort', 'descending');
    fireEvent.click(within(head).getByRole('button'));
    expect(head).toHaveAttribute('aria-sort', 'ascending');
    const titles = within(screen.getByRole('table'))
      .getAllByRole('link')
      .map((a) => a.textContent);
    // Ascending; the revoked channel without numbers stays last.
    expect(titles).toEqual(['Odonto Sorriso Oficial', 'Dra. Ana Lima', 'Studio Bella']);
  });

  it('never shows a number that spans channels', async () => {
    const { container } = renderPage();
    await screen.findByRole('table');
    expect(container.textContent).not.toMatch(/Total|Média|1º|lugar/);
    expect(screen.getByText('3 canais conectados')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Todos (3)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Precisam reconectar (1)' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('the status filter keeps only the channels that need reconnecting', async () => {
    renderPage();
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Precisam reconectar (1)' }));
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2);
    expect(rowOf('Studio Bella')).toBeInTheDocument();
  });

  it('a search that matches nothing keeps the filters and says so', async () => {
    renderPage();
    await screen.findByRole('table');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar canal ou cliente' }), {
      target: { value: 'nada disso' },
    });
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('Nenhum canal encontrado com esses filtros.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Todos (0)' })).toBeInTheDocument();
  });

  it('the client filter narrows to one channel', async () => {
    renderPage();
    await screen.findByRole('table');
    fireEvent.change(screen.getByRole('combobox', { name: 'Cliente' }), {
      target: { value: '2' },
    });
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(2);
    expect(rowOf('Odonto Sorriso Oficial')).toBeInTheDocument();
  });

  it('clicking a row opens the client YouTube analytics', async () => {
    renderPage();
    await screen.findByRole('table');
    fireEvent.click(rowOf('Odonto Sorriso Oficial'));
    expect(await screen.findByTestId('channel-page')).toBeInTheDocument();
  });

  it('the channel title is a real link to the client tab', async () => {
    renderPage();
    await screen.findByRole('table');
    expect(screen.getByRole('link', { name: 'Dra. Ana Lima' })).toHaveAttribute(
      'href',
      '/analytics/1/youtube',
    );
  });

  it('a revoked channel shows Reconectar and dashes', async () => {
    renderPage();
    await screen.findByRole('table');
    const bella = rowOf('Studio Bella');
    expect(within(bella).getByText('Reconectar')).toBeInTheDocument();
    // Inscritos included: a revoked authorization's YouTube data is not shown.
    expect(within(bella).queryByText('5.880')).toBeNull();
    expect(within(bella).getAllByText('-')).toHaveLength(6);
  });

  it('credits the data to YouTube and says each number is its own channel', async () => {
    renderPage();
    await screen.findByRole('table');
    expect(screen.getByText(/Dados do YouTube/)).toBeInTheDocument();
    expect(screen.getByText('Cada número pertence só ao canal da linha.')).toBeInTheDocument();
  });

  it('changing the period refetches with days=7', async () => {
    renderPage();
    await screen.findByRole('table');
    fireEvent.change(screen.getByRole('combobox', { name: 'Período' }), {
      target: { value: '7' },
    });
    await waitFor(() => expect(getYouTubePortfolio).toHaveBeenLastCalledWith(7));
  });

  it('keeps the previous rows on screen while the next period loads', async () => {
    renderPage();
    await screen.findByRole('table');
    vi.mocked(getYouTubePortfolio).mockReturnValueOnce(new Promise(() => {}));
    fireEvent.change(screen.getByRole('combobox', { name: 'Período' }), {
      target: { value: '90' },
    });
    await waitFor(() => expect(getYouTubePortfolio).toHaveBeenLastCalledWith(90));
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dra. Ana Lima' })).toBeInTheDocument();
  });

  it('empty state when no channel is connected', async () => {
    vi.mocked(getYouTubePortfolio).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('Nenhum canal conectado')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir para clientes' })).toHaveAttribute(
      'href',
      '/clientes',
    );
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('error state offers a retry', async () => {
    vi.mocked(getYouTubePortfolio).mockRejectedValueOnce(new Error('boom'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível carregar os dados do YouTube.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
  });
});
