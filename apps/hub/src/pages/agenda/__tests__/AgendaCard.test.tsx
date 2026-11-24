import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HubContext } from '../../../HubContext';
import type { HubAgendaItem } from '../../../types';

vi.mock('../../../api', () => ({
  responderAgenda: vi.fn(),
  cancelarRemarcacao: vi.fn(),
  agendaIcsUrl: (token: string, id: number) =>
    `https://x.supabase.co/functions/v1/hub-agenda/ocorrencia/${id}.ics?token=${token}`,
  downloadAgendaIcs: vi.fn(),
}));

import { downloadAgendaIcs } from '../../../api';
import { AgendaCard } from '../AgendaCard';

const baixar = vi.mocked(downloadAgendaIcs);

const ITEM: HubAgendaItem = {
  ocorrencia_id: 10,
  sequencia: 1,
  inicio: '2026-10-20T18:00:00+00:00',
  fim: '2026-10-20T19:00:00+00:00',
  dia_inteiro: false,
  data_inicio_local: '2026-10-20',
  data_fim_local: '2026-10-20',
  tz: 'America/Sao_Paulo',
  titulo: 'Gravação de reels',
  descricao: null,
  local: null,
  link_reuniao: null,
  resposta: null,
  remarcacao: null,
};

function renderCard(requireLogin: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <HubContext.Provider
        value={{
          bootstrap: {
            workspace: { name: 'Mesaas', logo_url: null, brand_color: '#0f766e' },
            cliente_nome: 'Clínica Aurora',
            cliente_foto_url: null,
            is_active: true,
            cliente_id: 14,
            feature_mensagens: true,
            feature_agenda: true,
            require_login: requireLogin,
          },
          token: 'tk',
          workspace: 'mesaas',
          theme: 'light',
          toggleTheme: () => {},
        }}
      >
        <AgendaCard item={ITEM} token="tk" agora={Date.parse('2026-10-07T15:00:00Z')} />
      </HubContext.Provider>
    </QueryClientProvider>,
  );
}

async function openMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'Mais opções' }));
  return screen.findByText('Baixar .ics');
}

describe('AgendaCard .ics control', () => {
  beforeEach(() => {
    baixar.mockReset().mockResolvedValue(undefined);
  });

  it('is a button that downloads through the API when the workspace requires login', async () => {
    renderCard(true);
    const item = await openMenu();

    expect(item.closest('a')).toBeNull();
    fireEvent.click(item);

    await waitFor(() => expect(baixar).toHaveBeenCalledWith('tk', 10));
  });

  it('is the plain download link otherwise', async () => {
    renderCard(false);
    const item = await openMenu();

    const link = item.closest('a');
    expect(link?.getAttribute('href')).toBe(
      'https://x.supabase.co/functions/v1/hub-agenda/ocorrencia/10.ics?token=tk',
    );
    expect(baixar).not.toHaveBeenCalled();
  });

  it('shows an error under the card when the download fails', async () => {
    baixar.mockRejectedValue(new Error('boom'));
    renderCard(true);
    fireEvent.click(await openMenu());

    expect(await screen.findByText('Não foi possível salvar. Tente novamente.')).toBeTruthy();
  });
});
