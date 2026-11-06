import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ideia } from '@/store';

// Phone branch of /ideias (below 768px). jsdom's matchMedia reports false, so
// useIsDesktop(768) is false here without a mock.

const { getIdeiasMock, getClientesMock } = vi.hoisted(() => ({
  getIdeiasMock: vi.fn(),
  getClientesMock: vi.fn(async () => [
    { id: 1, nome: 'Café Aurora' },
    { id: 2, nome: 'Pet Feliz' },
  ]),
}));

vi.mock('@/store', () => ({
  getIdeias: getIdeiasMock,
  getClientes: getClientesMock,
}));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ can: () => true }),
}));
// The real shell actions need the KB query and notifications; their own suites cover them.
vi.mock('@/components/layout/PhoneShellHeader', () => ({
  PhoneShellActions: () => <div data-testid="shell-actions" />,
}));
vi.mock('@/components/ideias/NovaIdeiaDialog', () => ({
  NovaIdeiaDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="dialog">nova-ideia</div> : null,
}));
vi.mock('@/components/ideias/IdeiaDrawer', () => ({
  IdeiaDrawer: ({ ideia }: { ideia: Ideia }) => <div data-testid="drawer">{ideia.titulo}</div>,
}));

const BASE: Ideia = {
  id: 'i1',
  workspace_id: 'w1',
  cliente_id: 1,
  titulo: 'Fotos da nova vitrine',
  descricao: null,
  links: [],
  tipo: 'solicitacao',
  tarefa_id: null,
  status: 'nova',
  comentario_agencia: null,
  comentario_autor_id: null,
  comentario_at: null,
  created_at: '2026-10-10T12:00:00Z',
  updated_at: '2026-10-10T12:00:00Z',
  clientes: { nome: 'Café Aurora' },
  comentario_autor: null,
  ideia_reactions: [],
  image_count: 0,
  origem: 'cliente',
  autor_membro_id: null,
  visivel_no_hub: true,
  autor: null,
  audio_r2_key: null,
  audio_duration_seconds: null,
  audio_transcript: null,
  audio_transcription_status: null,
};

const reaction = (id: number) =>
  ({ id, ideia_id: 'x', membro_id: id, emoji: '👍', membros: { nome: `M${id}` } }) as never;

const IDEIAS: Ideia[] = [
  {
    ...BASE,
    ideia_reactions: [reaction(1), reaction(2)],
    comentario_agencia: 'Boa!',
  },
  {
    ...BASE,
    id: 'i2',
    cliente_id: 2,
    titulo: 'Reels do pet da semana',
    tipo: 'ideia',
    status: 'em_analise',
    origem: 'agencia',
    visivel_no_hub: false,
    clientes: { nome: 'Pet Feliz' },
    created_at: '2026-09-05T12:00:00Z',
  },
];

beforeEach(() => {
  getIdeiasMock.mockReset();
  getIdeiasMock.mockResolvedValue(IDEIAS);
});

async function renderPage() {
  const { default: IdeiasPage } = await import('../IdeiasPage');
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/ideias']}>
        <IdeiasPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByText('Fotos da nova vitrine');
}

function rows() {
  return within(screen.getByRole('list', { name: 'Ideias' })).getAllByRole('listitem');
}

describe('IdeiasPage on phones', () => {
  it('renders the page header with the help text and grouped rows instead of the table', async () => {
    await renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Ideias' })).toBeInTheDocument();
    expect(
      screen.getByText('Ideias enviadas pelos clientes no portal ou criadas pela equipe.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(rows()).toHaveLength(2);
    expect(screen.getByText('2 ideias')).toBeInTheDocument();
  });

  it('shows cliente, tipo, origem and the reactions/response line on each row', async () => {
    await renderPage();
    const [first, second] = rows();
    expect(first).toHaveTextContent('Café Aurora · Solicitação · Cliente');
    expect(first).toHaveTextContent('2 reações · Respondida');
    expect(first).toHaveTextContent('Nova');
    expect(second).toHaveTextContent('Pet Feliz · Ideia · Agência');
    expect(second).toHaveTextContent('Sem reações · Oculta do Hub');
    expect(second).toHaveTextContent('Em análise');
  });

  it('opens the ideia screen from a row and the form from "+"', async () => {
    await renderPage();
    fireEvent.click(screen.getByText('Reels do pet da semana'));
    expect(screen.getByTestId('drawer')).toHaveTextContent('Reels do pet da semana');

    fireEvent.click(screen.getByRole('button', { name: 'Nova ideia' }));
    expect(screen.getByTestId('dialog')).toBeInTheDocument();
  });

  it('searches by title or cliente from the header search field', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar por título ou cliente' }), {
      target: { value: 'pet' },
    });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toHaveTextContent('Reels do pet da semana');

    // Closing the search clears it.
    fireEvent.click(screen.getByRole('button', { name: 'Fechar busca' }));
    expect(rows()).toHaveLength(2);
  });

  it('filters by tipo and status in the filters sheet, with removable chips and Limpar', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Filtros' }));
    const sheet = await screen.findByRole('dialog', { name: 'Filtros' });

    fireEvent.click(within(sheet).getByRole('button', { name: 'Solicitação' }));
    expect(within(sheet).getByRole('button', { name: 'Ver 1' })).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Em análise' }));
    expect(within(sheet).getByRole('button', { name: 'Ver 0' })).toBeInTheDocument();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Limpar' }));
    expect(within(sheet).getByRole('button', { name: 'Ver 2' })).toBeInTheDocument();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Em análise' }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Ver 1' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    expect(rows()).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Filtros, 1 ativo' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remover filtro de status' }));
    expect(rows()).toHaveLength(2);
  });

  it('filters by cliente through the drill-in list, one cliente at a time', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Filtros' }));
    const sheet = await screen.findByRole('dialog', { name: 'Filtros' });
    fireEvent.click(within(sheet).getByRole('button', { name: /Cliente/ }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Pet Feliz' }));
    expect(within(sheet).getByRole('button', { name: 'Ver 1' })).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Café Aurora' }));
    // The second pick replaces the first instead of adding to it.
    expect(within(sheet).getByRole('button', { name: 'Café Aurora' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(sheet).getByRole('button', { name: 'Pet Feliz' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(within(sheet).getByRole('button', { name: 'Ver 1' })).toBeInTheDocument();
  });

  it('filters by a start/end date range with local dates', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Filtros' }));
    const sheet = await screen.findByRole('dialog', { name: 'Filtros' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Intervalo' }));
    fireEvent.change(within(sheet).getByLabelText('De'), { target: { value: '2026-10-02' } });
    fireEvent.change(within(sheet).getByLabelText('Até'), { target: { value: '2026-10-20' } });
    expect(within(sheet).getByRole('button', { name: 'Ver 1' })).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Ver 1' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(rows()[0]).toHaveTextContent('Fotos da nova vitrine');
    expect(screen.getByText('02/10/2026 a 20/10/2026')).toBeInTheDocument();
  });

  it('filters by a single month', async () => {
    await renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Filtros' }));
    const sheet = await screen.findByRole('dialog', { name: 'Filtros' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Um mês' }));
    fireEvent.change(within(sheet).getByLabelText('Mês'), { target: { value: '2026-09' } });
    expect(within(sheet).getByRole('button', { name: 'Ver 1' })).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Ver 1' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(rows()[0]).toHaveTextContent('Reels do pet da semana');
    expect(screen.getByText('Setembro de 2026')).toBeInTheDocument();
  });
});
