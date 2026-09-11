import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({ getPostProcessEvents: vi.fn() }));
vi.mock('@/store', () => store);

import { PostProductionSection } from '../PostProductionSection';
import type { PostProcess } from '../../../../store';

const process: PostProcess = {
  id: 5,
  conta_id: 'c',
  post_id: 77,
  template_id: 3,
  template_nome: 'Redes',
  assinatura: '',
  origem_workflow_id: 9,
  origem_descricao: 'Conteúdo de setembro, etapa Design',
  estado: 'ativo',
  motivo_encerramento: null,
  etapa_atual: 1,
  modo_prazo: 'padrao',
  board_position: 0,
  revisao: 1,
  created_by: null,
  created_at: '',
  updated_at: '',
  concluido_em: null,
  steps: [
    {
      id: 1,
      conta_id: 'c',
      process_id: 5,
      ordem: 0,
      nome: 'Copy',
      tipo: 'padrao',
      responsavel_id: null,
      prazo_dias: 2,
      tipo_prazo: 'uteis',
      prazo_efetivo: null,
      estado: 'herdado',
      iniciado_em: null,
      concluido_em: null,
      interrompido_em: null,
      origem_etapa_ordem: 0,
      origem_etapa_nome: 'Copy',
    },
    {
      id: 2,
      conta_id: 'c',
      process_id: 5,
      ordem: 1,
      nome: 'Design',
      tipo: 'padrao',
      responsavel_id: 7,
      prazo_dias: 3,
      tipo_prazo: 'uteis',
      prazo_efetivo: '2026-09-20T15:00:00Z',
      estado: 'ativo',
      iniciado_em: '2026-09-10T00:00:00Z',
      concluido_em: null,
      interrompido_em: null,
      origem_etapa_ordem: 1,
      origem_etapa_nome: 'Design',
    },
    {
      id: 3,
      conta_id: 'c',
      process_id: 5,
      ordem: 2,
      nome: 'Aprovação',
      tipo: 'aprovacao_cliente',
      responsavel_id: null,
      prazo_dias: 1,
      tipo_prazo: 'corridos',
      prazo_efetivo: null,
      estado: 'pendente',
      iniciado_em: null,
      concluido_em: null,
      interrompido_em: null,
      origem_etapa_ordem: 2,
      origem_etapa_nome: 'Aprovação',
    },
  ],
};

function renderSection() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PostProductionSection
        process={process}
        postId={77}
        membros={[{ id: 7, nome: 'Ana' } as never]}
        postStatus="rascunho"
      />
    </QueryClientProvider>,
  );
}

describe('PostProductionSection', () => {
  it('mostra origem, etapas com estado, responsável e prazo, a nota de propriedades e nenhum botão', async () => {
    store.getPostProcessEvents.mockResolvedValue([
      {
        id: 1,
        conta_id: 'c',
        post_id: 77,
        process_id: 5,
        evento: 'desmembrado',
        actor_user_id: null,
        actor_name: 'Ana',
        origem: 'workspace_user',
        antes: { workflow_titulo: 'Conteúdo de setembro', etapa_nome: 'Design' },
        depois: null,
        created_at: '2026-09-10T00:00:00Z',
      },
    ]);
    renderSection();
    expect(screen.getByRole('heading', { name: 'Produção' })).toBeInTheDocument();
    expect(
      screen.getByText('Desmembrado de Conteúdo de setembro, etapa Design'),
    ).toBeInTheDocument();
    expect(screen.getByText('Copy')).toBeInTheDocument();
    expect(screen.getByText('Herdada')).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getAllByText('Sem responsável')).toHaveLength(2);
    expect(screen.getByText(/^20 set/)).toBeInTheDocument();
    expect(screen.getByText(/Aprovação do cliente/)).toBeInTheDocument();
    expect(
      screen.getByText('Propriedades do template só valem dentro de um fluxo'),
    ).toBeInTheDocument();
    expect(
      await screen.findByText('Desmembrado de Conteúdo de setembro na etapa Design'),
    ).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    await waitFor(() => expect(store.getPostProcessEvents).toHaveBeenCalledWith([77]));
  });

  it('mostra só os eventos do processo atual, não os de um processo anterior do mesmo post', async () => {
    store.getPostProcessEvents.mockResolvedValue([
      {
        id: 10,
        conta_id: 'c',
        post_id: 77,
        process_id: 3,
        evento: 'removido',
        actor_user_id: null,
        actor_name: 'Ana',
        origem: 'workspace_user',
        antes: null,
        depois: null,
        created_at: '2026-08-01T00:00:00Z',
      },
      {
        id: 11,
        conta_id: 'c',
        post_id: 77,
        process_id: 5,
        evento: 'concluido',
        actor_user_id: null,
        actor_name: 'Ana',
        origem: 'workspace_user',
        antes: null,
        depois: null,
        created_at: '2026-09-10T00:00:00Z',
      },
    ]);
    renderSection();
    expect(await screen.findByText('Processo concluído')).toBeInTheDocument();
    expect(screen.queryByText('Processo removido')).not.toBeInTheDocument();
  });
});
