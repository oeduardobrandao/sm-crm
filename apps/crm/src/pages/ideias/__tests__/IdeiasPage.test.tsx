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
// need to trigger the same onSaved(id) contract it calls after a successful
// create/save, and expose `editing` so tests can see which mode IdeiasPage
// put the dialog in.
vi.mock('@/components/ideias/NovaIdeiaDialog', () => ({
  NovaIdeiaDialog: ({
    open,
    editing,
    onSaved,
  }: {
    open: boolean;
    editing?: Ideia | null;
    onSaved: (id: string) => void;
  }) =>
    open ? (
      <div data-testid="dialog" data-editing-titulo={editing?.titulo ?? ''}>
        <button type="button" onClick={() => onSaved(editing ? editing.id : 'new-ideia-id')}>
          fake-criar-ideia
        </button>
      </div>
    ) : null,
}));
vi.mock('@/components/ideias/IdeiaDrawer', () => ({
  IdeiaDrawer: ({ ideia, onEdit }: { ideia: Ideia; onEdit?: () => void }) => (
    <div data-testid="drawer">
      {ideia.titulo}
      {onEdit && (
        <button type="button" onClick={onEdit}>
          fake-editar
        </button>
      )}
    </div>
  ),
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

  it('opens NovaIdeiaDialog in edit mode for the selected ideia, closing the drawer first', async () => {
    await renderPage();
    await waitFor(() => expect(getIdeiasMock).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText('Ideia antiga'));
    fireEvent.click(await screen.findByText('fake-editar'));

    expect(screen.queryByTestId('drawer')).not.toBeInTheDocument();
    expect(await screen.findByTestId('dialog')).toHaveAttribute(
      'data-editing-titulo',
      'Ideia antiga',
    );
  });
});
