import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  getPostProcessEvents: vi.fn(),
  updatePostProcessStep: vi.fn(),
}));
vi.mock('@/store', () => store);
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Radix Select requires pointer-capture/scrollIntoView APIs jsdom doesn't implement --
// same stubs used by NewAvulsoDialog.test.tsx / MigrateTemplateDialog.test.tsx.
beforeAll(() => {
  (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () =>
    false;
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
});

// Default: os testes de edição não têm asserção sobre o histórico de eventos;
// sem isto o react-query loga "Query data cannot be undefined" no stderr.
beforeEach(() => {
  store.getPostProcessEvents.mockResolvedValue([]);
});

import { toast } from 'sonner';
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
  // Encerrado (não 'ativo'): este fixture cobre o caminho só-leitura (rótulos,
  // origem, histórico) da fase 3. Na fase 4 um processo 'ativo' torna as
  // etapas pendente/ativo editáveis (Task 10), o que substitui os spans de
  // responsável/prazo destes mesmos passos por controles -- os fixtures
  // dedicados a isso são `activeProcessWithPendingStep` e `concludedProcess`
  // abaixo.
  estado: 'encerrado',
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

// Processo ativo com uma etapa 'pendente' e uma etapa 'ativo' editáveis
// (spec §5.4, Task 10): `prazo_efetivo` da etapa Design é construído com os
// mesmos componentes locais que `endOfLocalDay` usa, para que o round-trip
// toLocalISODate -> parseLocalISODate -> endOfLocalDay reproduza o valor
// original independente do fuso horário de quem roda o teste.
const activeProcessWithPendingStep: PostProcess = {
  id: 6,
  conta_id: 'c',
  post_id: 88,
  template_id: null,
  template_nome: null,
  assinatura: '',
  origem_workflow_id: null,
  origem_descricao: null,
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
      id: 21,
      conta_id: 'c',
      process_id: 6,
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
      id: 22,
      conta_id: 'c',
      process_id: 6,
      ordem: 1,
      nome: 'Design',
      tipo: 'padrao',
      responsavel_id: 4,
      prazo_dias: 3,
      tipo_prazo: 'uteis',
      prazo_efetivo: new Date(2026, 8, 20, 23, 59, 59, 999).toISOString(),
      estado: 'pendente',
      iniciado_em: null,
      concluido_em: null,
      interrompido_em: null,
      origem_etapa_ordem: 1,
      origem_etapa_nome: 'Design',
    },
  ],
};

// Processo concluído, com etapas concluídas: cobre "sem controles" mesmo
// quando os steps individualmente estariam em estados variados.
const concludedProcess: PostProcess = {
  id: 7,
  conta_id: 'c',
  post_id: 99,
  template_id: null,
  template_nome: null,
  assinatura: '',
  origem_workflow_id: null,
  origem_descricao: null,
  estado: 'concluido',
  motivo_encerramento: null,
  etapa_atual: 2,
  modo_prazo: 'padrao',
  board_position: 0,
  revisao: 3,
  created_by: null,
  created_at: '',
  updated_at: '',
  concluido_em: '2026-09-10T00:00:00Z',
  steps: [
    {
      id: 31,
      conta_id: 'c',
      process_id: 7,
      ordem: 0,
      nome: 'Copy',
      tipo: 'padrao',
      responsavel_id: null,
      prazo_dias: 2,
      tipo_prazo: 'uteis',
      prazo_efetivo: null,
      estado: 'concluido',
      iniciado_em: '2026-09-01T00:00:00Z',
      concluido_em: '2026-09-02T00:00:00Z',
      interrompido_em: null,
      origem_etapa_ordem: 0,
      origem_etapa_nome: 'Copy',
    },
    {
      id: 32,
      conta_id: 'c',
      process_id: 7,
      ordem: 1,
      nome: 'Design',
      tipo: 'padrao',
      responsavel_id: null,
      prazo_dias: 3,
      tipo_prazo: 'uteis',
      prazo_efetivo: null,
      estado: 'concluido',
      iniciado_em: '2026-09-02T00:00:00Z',
      concluido_em: '2026-09-05T00:00:00Z',
      interrompido_em: null,
      origem_etapa_ordem: 1,
      origem_etapa_nome: 'Design',
    },
  ],
};

function renderSection(overrides?: {
  process?: PostProcess;
  membros?: Array<{ id: number; nome: string }>;
}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const activeProcess = overrides?.process ?? process;
  render(
    <QueryClientProvider client={qc}>
      <PostProductionSection
        process={activeProcess}
        postId={activeProcess.post_id}
        membros={(overrides?.membros ?? [{ id: 7, nome: 'Ana' }]) as never}
        postStatus="rascunho"
      />
    </QueryClientProvider>,
  );
  return { qc };
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

  it('etapa pendente: trocar responsável envia os DOIS valores e invalida o processo', async () => {
    store.updatePostProcessStep.mockResolvedValue({ ok: true, revisao: 2, step: {} });
    const { qc } = renderSection({
      process: activeProcessWithPendingStep,
      membros: [
        { id: 4, nome: 'Ana' },
        { id: 9, nome: 'Bia' },
      ],
    });
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    // Radix Select: open the trigger and pick the option
    fireEvent.click(screen.getByRole('combobox', { name: 'Responsável da etapa Design' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Bia' }));
    await waitFor(() =>
      expect(store.updatePostProcessStep).toHaveBeenCalledWith({
        processId: activeProcessWithPendingStep.id,
        expectedRevisao: activeProcessWithPendingStep.revisao,
        ordem: 1,
        responsavelId: 9,
        prazoEfetivo: activeProcessWithPendingStep.steps[1].prazo_efetivo,
      }),
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['post-process', activeProcessWithPendingStep.post_id],
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['post-processes'] });
  });

  it('prazo: data local vira fim do dia; limpar manda null', async () => {
    store.updatePostProcessStep.mockResolvedValue({ ok: true, revisao: 2, step: {} });
    renderSection({ process: activeProcessWithPendingStep, membros: [] });
    const input = screen.getByLabelText('Prazo da etapa Design') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2026-09-25' } });
    await waitFor(() =>
      expect(store.updatePostProcessStep).toHaveBeenLastCalledWith(
        expect.objectContaining({
          prazoEfetivo: new Date(2026, 8, 25, 23, 59, 59, 999).toISOString(),
        }),
      ),
    );
    fireEvent.change(input, { target: { value: '' } });
    await waitFor(() =>
      expect(store.updatePostProcessStep).toHaveBeenLastCalledWith(
        expect.objectContaining({ prazoEfetivo: null }),
      ),
    );
  });

  it('rollback: falha step_not_editable → valor volta ao do servidor e toast mapeado', async () => {
    store.updatePostProcessStep.mockRejectedValueOnce({
      message: 'step_not_editable',
      code: 'P0001',
    });
    renderSection({ process: activeProcessWithPendingStep, membros: [] });
    const input = screen.getByLabelText('Prazo da etapa Design') as HTMLInputElement;
    const before = input.value;
    fireEvent.change(input, { target: { value: '2026-09-25' } });
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Só etapas pendentes ou em andamento podem ser editadas.',
      ),
    );
    await waitFor(() => expect(input.value).toBe(before));
  });

  it('etapas concluídas/herdadas/ignoradas e processo concluído não têm controles', () => {
    renderSection({ process: concludedProcess, membros: [] });
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(screen.queryAllByLabelText(/Prazo da etapa/)).toHaveLength(0);
  });
});
