import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ideia } from '@/store';

const { getIdeiasMock, getClientesMock } = vi.hoisted(() => ({
  getIdeiasMock: vi.fn(),
  getClientesMock: vi.fn(async () => []),
}));

vi.mock('@/store', () => ({
  getIdeias: getIdeiasMock,
  getClientes: getClientesMock,
}));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ can: () => true }),
}));
// NovaIdeiaDialog's real form is exercised in its own test suite; here we only
// need to trigger the same onCreated(id) contract it calls after a successful
// create, to test how IdeiasPage reacts to it.
vi.mock('@/components/ideias/NovaIdeiaDialog', () => ({
  NovaIdeiaDialog: ({ open, onCreated }: { open: boolean; onCreated: (id: string) => void }) =>
    open ? (
      <button type="button" onClick={() => onCreated('new-ideia-id')}>
        fake-criar-ideia
      </button>
    ) : null,
}));
vi.mock('@/components/ideias/IdeiaDrawer', () => ({
  IdeiaDrawer: ({ ideia }: { ideia: Ideia }) => <div data-testid="drawer">{ideia.titulo}</div>,
}));

const BASE_IDEIA: Ideia = {
  id: 'old-1',
  workspace_id: 'w1',
  cliente_id: 1,
  titulo: 'Ideia antiga',
  descricao: 'desc',
  links: [],
  tipo: 'ideia',
  tarefa_id: null,
  status: 'nova',
  comentario_agencia: null,
  comentario_autor_id: null,
  comentario_at: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  clientes: { nome: 'Cliente Antigo' },
  comentario_autor: null,
  ideia_reactions: [],
  image_count: 0,
  origem: 'agencia',
  autor_membro_id: null,
  visivel_no_hub: false,
  autor: null,
  audio_r2_key: null,
  audio_duration_seconds: null,
  audio_transcript: null,
  audio_transcription_status: null,
};

const FRESH_IDEIA: Ideia = {
  ...BASE_IDEIA,
  id: 'new-ideia-id',
  titulo: 'Ideia recem-criada',
};

beforeEach(() => {
  getIdeiasMock.mockReset();
  getIdeiasMock
    .mockResolvedValueOnce([BASE_IDEIA]) // initial load, before creation
    .mockResolvedValueOnce([BASE_IDEIA, FRESH_IDEIA]); // refetch triggered by the create flow
});

async function renderPage() {
  const { default: IdeiasPage } = await import('../IdeiasPage');
  const qc = new QueryClient();
  render(
    <QueryClientProvider client={qc}>
      <IdeiasPage />
    </QueryClientProvider>,
  );
}

describe('IdeiasPage', () => {
  it('opens the drawer for the ideia NovaIdeiaDialog just created, even though the list was stale at click time', async () => {
    await renderPage();
    await waitFor(() => expect(getIdeiasMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText('Nova ideia'));
    fireEvent.click(screen.getByText('fake-criar-ideia'));

    await waitFor(() =>
      expect(screen.getByTestId('drawer')).toHaveTextContent('Ideia recem-criada'),
    );
  });
});
