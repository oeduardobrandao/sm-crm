import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../lib/api', () => ({
  listPopups: vi.fn(),
  createPopup: vi.fn(),
  updatePopup: vi.fn(),
  deletePopup: vi.fn(),
  listPlans: vi.fn(),
  listWorkspaces: vi.fn(),
}));
vi.mock('../../lib/inline-image', () => ({
  uploadInlineImage: vi.fn(),
  resolveInlineImageUrls: vi.fn(),
}));

import { createPopup, listPlans, listPopups, listWorkspaces } from '../../lib/api';
import { resolveInlineImageUrls } from '../../lib/inline-image';
import PopupsPage from '../PopupsPage';

const popup = {
  id: 'p1',
  pages: [
    {
      title: 'Analytics de Stories',
      eyebrow: 'Novo',
      body: 'b',
      image_key: null,
      cta_label: null,
      cta_url: null,
    },
    {
      title: 'Segunda',
      eyebrow: null,
      body: 'b2',
      image_key: null,
      cta_label: null,
      cta_url: null,
    },
  ],
  cta_label: 'Ver',
  cta_url: '/ajuda',
  cta_style: 'ink',
  secondary_label: null,
  frequency: 'once',
  require_ack: true,
  target_mode: 'all',
  target_plan_ids: null,
  target_workspace_ids: null,
  starts_at: null,
  ends_at: null,
  status: 'active',
  created_by: null,
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
  counts: { seen: 312, closed: 225, cta: 87, ack: 0 },
};

beforeEach(() => {
  vi.mocked(listPopups).mockResolvedValue({ popups: [popup] } as never);
  vi.mocked(listPlans).mockResolvedValue({ plans: [{ id: 'pro', name: 'Pro' }] } as never);
  vi.mocked(listWorkspaces).mockResolvedValue({ workspaces: [] } as never);
  vi.mocked(resolveInlineImageUrls).mockResolvedValue({});
  vi.mocked(createPopup).mockResolvedValue({ popup } as never);
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <PopupsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PopupsPage lista', () => {
  it('mostra título da primeira página, badge de páginas, frequência com ack e métricas', async () => {
    renderPage();
    expect(await screen.findByText('Analytics de Stories')).toBeInTheDocument();
    expect(screen.getByText('2 páginas')).toBeInTheDocument();
    expect(screen.getByText('Uma vez · confirmação')).toBeInTheDocument();
    expect(screen.getByText(/seen 312/)).toBeInTheDocument();
    expect(screen.getByText(/cta 87/)).toBeInTheDocument();
  });
});

describe('PopupsPage editor', () => {
  it('New Popup abre com uma aba; submit vazio mostra erros inline e não chama a API', async () => {
    renderPage();
    await screen.findByText('Analytics de Stories');
    fireEvent.click(screen.getByRole('button', { name: /Novo popup/ }));
    expect(screen.getByRole('heading', { name: 'Novo popup' })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Criar' }));
    expect(await screen.findByText('Title is required')).toBeInTheDocument();
    expect(createPopup).not.toHaveBeenCalled();
  });

  it('adiciona página, preenche, envia payload com pages e sem key; require ack desabilita frequência', async () => {
    renderPage();
    await screen.findByText('Analytics de Stories');
    fireEvent.click(screen.getByRole('button', { name: /Novo popup/ }));

    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Página 1' } });
    fireEvent.change(screen.getByLabelText('Corpo (Markdown)'), { target: { value: 'corpo 1' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Página' }));
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Página 2' } });
    fireEvent.change(screen.getByLabelText('Corpo (Markdown)'), { target: { value: 'corpo 2' } });

    fireEvent.click(screen.getByLabelText(/Exigir confirmação/));
    expect(screen.getByLabelText('Toda sessão até clicar no CTA')).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Criar' }));
    await waitFor(() => expect(createPopup).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(createPopup).mock.calls[0][0];
    expect(payload.pages).toEqual([
      {
        title: 'Página 1',
        eyebrow: null,
        body: 'corpo 1',
        image_key: null,
        cta_label: null,
        cta_url: null,
      },
      {
        title: 'Página 2',
        eyebrow: null,
        body: 'corpo 2',
        image_key: null,
        cta_label: null,
        cta_url: null,
      },
    ]);
    expect(payload.require_ack).toBe(true);
    expect(payload.frequency).toBe('once');
    expect(JSON.stringify(payload)).not.toContain('"key"');
  });

  it('CTA por página vai no payload da página, não no global', async () => {
    renderPage();
    await screen.findByText('Analytics de Stories');
    fireEvent.click(screen.getByRole('button', { name: /Novo popup/ }));
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'P1' } });
    fireEvent.change(screen.getByLabelText('Corpo (Markdown)'), { target: { value: 'b' } });
    fireEvent.change(screen.getByLabelText('Rótulo do CTA da página'), {
      target: { value: 'Ver só aqui' },
    });
    fireEvent.change(screen.getByLabelText('URL do CTA da página'), {
      target: { value: '/so-aqui' },
    });
    expect(screen.getByRole('button', { name: 'Ver só aqui' })).toBeInTheDocument(); // preview
    fireEvent.click(screen.getByRole('button', { name: 'Criar' }));
    await waitFor(() => expect(createPopup).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(createPopup).mock.calls[0][0] as {
      pages: Array<Record<string, unknown>>;
      cta_url: unknown;
    };
    expect(payload.pages[0].cta_label).toBe('Ver só aqui');
    expect(payload.pages[0].cta_url).toBe('/so-aqui');
    expect(payload.cta_url).toBeNull();
  });

  it('default do secundário segue o CTA efetivo da última página: "Agora não" com CTA só na página, sem CTA global', async () => {
    renderPage();
    await screen.findByText('Analytics de Stories');
    fireEvent.click(screen.getByRole('button', { name: /Novo popup/ }));
    fireEvent.change(screen.getByLabelText('Rótulo do CTA da página'), {
      target: { value: 'Ver' },
    });
    fireEvent.change(screen.getByLabelText('URL do CTA da página'), { target: { value: '/x' } });
    expect(screen.getByRole('button', { name: 'Agora não' })).toBeInTheDocument();
  });

  it('preview segue a aba selecionada', async () => {
    renderPage();
    fireEvent.click(await screen.findByText('Analytics de Stories'));
    expect(screen.getByRole('heading', { name: 'Editar popup' })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('tab')[1]);
    expect(screen.getByRole('heading', { level: 2, name: 'Segunda' })).toBeInTheDocument();
  });

  it('preview sanitiza links do markdown como o CRM: //host vira #, caminho interno passa', async () => {
    renderPage();
    await screen.findByText('Analytics de Stories');
    fireEvent.click(screen.getByRole('button', { name: /Novo popup/ }));
    fireEvent.change(screen.getByLabelText('Corpo (Markdown)'), {
      target: {
        value: '[a](//evil.com) [b](/ajuda) [c](https://x.y) [d](/\\evil.com) [e](</\t/evil.com>)',
      },
    });
    expect(screen.getByRole('link', { name: 'a' })).toHaveAttribute('href', '#');
    expect(screen.getByRole('link', { name: 'b' })).toHaveAttribute('href', '/ajuda');
    expect(screen.getByRole('link', { name: 'c' })).toHaveAttribute('href', 'https://x.y');
    expect(screen.getByRole('link', { name: 'd' })).toHaveAttribute('href', '#');
    expect(screen.getByRole('link', { name: 'e' })).toHaveAttribute('href', '#');
  });

  it('editar a página limpa o erro inline', async () => {
    renderPage();
    await screen.findByText('Analytics de Stories');
    fireEvent.click(screen.getByRole('button', { name: /Novo popup/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Criar' }));
    expect(await screen.findByText('Title is required')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Ok' } });
    expect(screen.queryByText('Title is required')).toBeNull();
  });
});
