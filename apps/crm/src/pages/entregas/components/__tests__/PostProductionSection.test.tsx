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
  // A seção recolhida persiste em sessionStorage por postId; sem isto um
  // teste que abre a seção "vaza" o estado aberto para os próximos que usam
  // o mesmo postId.
  sessionStorage.clear();
});

/** Abre a seção clicando no cabeçalho (botão). */
function openSection() {
  fireEvent.click(screen.getByRole('button', { name: /Produção/ }));
}

import { toast } from 'sonner';
import { PostProductionSection } from '../PostProductionSection';
import type { PostProcess } from '../../../../store';
import { computeDeadlineDate } from '../../hooks/useEntregasData';
import { endOfLocalDay, parseLocalISODate, toLocalISODate } from '@/utils/postDate';
import { formatEtapaDeadlineDay } from '../../etapaPrazo';

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
// (spec §5.4, Task 10 + spec 2026-09-12 §2, Task "prazo por dias"): a etapa
// Design tem `iniciado_em` -- âncora exigida por `computeDeadlineDate` --
// para exercitar o modo "dias" (padrão de um processo `modo_prazo=padrao`).
// `prazo_efetivo` fica com um valor pré-existente qualquer: o modo "dias" o
// ignora (sempre recalcula) e só o modo "fixa" o lê como valor inicial.
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
      iniciado_em: '2026-09-10T00:00:00Z',
      concluido_em: null,
      interrompido_em: null,
      origem_etapa_ordem: 1,
      origem_etapa_nome: 'Design',
    },
  ],
};

// Mesmo fixture, mas a etapa Design ainda não tem `iniciado_em` (etapa
// pendente que nunca chegou a ficar ativa): cobre "definida ao iniciar a
// etapa" e o envio de `prazoEfetivo: null` quando não há âncora para calcular.
const activeProcessPendingNotStarted: PostProcess = {
  ...activeProcessWithPendingStep,
  id: 10,
  post_id: 105,
  steps: [
    { ...activeProcessWithPendingStep.steps[0] },
    { ...activeProcessWithPendingStep.steps[1], iniciado_em: null },
  ],
};

// Etapa de um processo 'padrao' que JÁ foi salva em modo "data fixa": o save
// de "fixa" grava `prazo_dias`/`tipo_prazo` nulos e deixa só `prazo_efetivo`.
// É o estado em que o editor tem de reabrir em "fixa" -- `stepMode` é local e
// some no refetch que o próprio save provoca.
const dataFixaIso = new Date(2026, 8, 25, 23, 59, 59, 999).toISOString();
const processoComEtapaEmDataFixa: PostProcess = {
  ...activeProcessWithPendingStep,
  id: 12,
  post_id: 120,
  steps: [
    { ...activeProcessWithPendingStep.steps[0] },
    {
      ...activeProcessWithPendingStep.steps[1],
      prazo_dias: null,
      tipo_prazo: null,
      prazo_efetivo: dataFixaIso,
    },
  ],
};

// Processo `modo_prazo` diferente de 'padrao' (cada etapa já nasce com data
// fixa materializada, spec §2): editar etapa continua só com o input de data
// livre, sem os controles novos de dias/tipo_prazo nem a alternância.
const nonPadraoProcess: PostProcess = {
  ...activeProcessWithPendingStep,
  id: 11,
  post_id: 110,
  modo_prazo: 'data_entrega',
  steps: [
    { ...activeProcessWithPendingStep.steps[0] },
    { ...activeProcessWithPendingStep.steps[1] },
  ],
};

// Processo ativo com DUAS etapas editáveis (uma 'ativo', uma 'pendente'):
// dedicado à regressão do bug de `expectedRevisao` obsoleto -- salvar a
// etapa 1 não pode deixar a etapa 2 editável e disparar uma segunda RPC
// concorrente com o mesmo `revisao` do prop (que só é atualizado depois que
// a query do processo é invalidada e o pai re-renderiza).
const activeProcessWithTwoEditableSteps: PostProcess = {
  id: 8,
  conta_id: 'c',
  post_id: 100,
  template_id: null,
  template_nome: null,
  assinatura: '',
  origem_workflow_id: null,
  origem_descricao: null,
  estado: 'ativo',
  motivo_encerramento: null,
  etapa_atual: 0,
  modo_prazo: 'padrao',
  board_position: 0,
  revisao: 1,
  created_by: null,
  created_at: '',
  updated_at: '',
  concluido_em: null,
  steps: [
    {
      id: 41,
      conta_id: 'c',
      process_id: 8,
      ordem: 0,
      nome: 'Copy',
      tipo: 'padrao',
      responsavel_id: 4,
      prazo_dias: 2,
      tipo_prazo: 'uteis',
      prazo_efetivo: null,
      estado: 'ativo',
      iniciado_em: '2026-09-10T00:00:00Z',
      concluido_em: null,
      interrompido_em: null,
      origem_etapa_ordem: 0,
      origem_etapa_nome: 'Copy',
    },
    {
      id: 42,
      conta_id: 'c',
      process_id: 8,
      ordem: 1,
      nome: 'Design',
      tipo: 'padrao',
      responsavel_id: null,
      prazo_dias: 3,
      tipo_prazo: 'uteis',
      prazo_efetivo: null,
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

// Processo ativo parado numa etapa de aprovação do cliente: cobre a dica
// "Cliente aprovou. Avançar etapa?", que é um CTA e não some com a seção
// recolhida.
const activeProcessAguardandoCliente: PostProcess = {
  ...activeProcessWithPendingStep,
  id: 9,
  post_id: 101,
  steps: [
    { ...activeProcessWithPendingStep.steps[0] },
    {
      ...activeProcessWithPendingStep.steps[1],
      tipo: 'aprovacao_cliente',
      estado: 'ativo',
    },
  ],
};

function renderSection(overrides?: {
  process?: PostProcess;
  membros?: Array<{ id: number; nome: string }>;
  postStatus?: string;
}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const activeProcess = overrides?.process ?? process;
  const result = render(
    <QueryClientProvider client={qc}>
      <PostProductionSection
        process={activeProcess}
        postId={activeProcess.post_id}
        membros={(overrides?.membros ?? [{ id: 7, nome: 'Ana' }]) as never}
        postStatus={overrides?.postStatus ?? 'rascunho'}
      />
    </QueryClientProvider>,
  );
  return { qc, unmount: result.unmount };
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
    // O heading embrulha o botão de disclosure, então o nome acessível inclui
    // o badge de estado ("Produção Encerrado").
    expect(screen.getByRole('heading', { name: /^Produção/ })).toBeInTheDocument();
    openSection();
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
    // Único botão é o próprio cabeçalho (toggle de abrir/fechar) -- sem
    // ações de comando (Avançar/Voltar/...) na seção.
    expect(screen.queryAllByRole('button')).toHaveLength(1);
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
    openSection();
    expect(await screen.findByText('Processo concluído')).toBeInTheDocument();
    expect(screen.queryByText('Processo removido')).not.toBeInTheDocument();
  });

  it('modo dias (padrão): renderiza número + select e nenhum input de data', () => {
    renderSection({ process: activeProcessWithPendingStep, membros: [] });
    openSection();
    expect(screen.getByLabelText('Dias da etapa Design')).toHaveValue(3);
    expect(
      screen.getByRole('combobox', { name: 'Tipo de prazo da etapa Design' }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Prazo da etapa Design')).not.toBeInTheDocument();
    const expected = computeDeadlineDate('2026-09-10T00:00:00Z', 3, 'uteis');
    // O nome acessível começa pelo texto visível (WCAG 2.5.3) e completa a ação.
    expect(
      screen.getByRole('button', {
        name: `${formatEtapaDeadlineDay(expected)}: usar data fixa na etapa Design`,
      }),
    ).toBeInTheDocument();
  });

  it('editar os dias só grava no blur (digitar não dispara RPC por tecla)', async () => {
    store.updatePostProcessStep.mockResolvedValue({ ok: true, revisao: 2, step: {} });
    renderSection({ process: activeProcessWithPendingStep, membros: [] });
    openSection();
    const input = screen.getByLabelText('Dias da etapa Design');
    // Digitar "15" em dois eventos: nenhum salva, senão o campo ficaria
    // desabilitado no meio e engoliria o segundo dígito.
    fireEvent.change(input, { target: { value: '1' } });
    fireEvent.change(input, { target: { value: '15' } });
    expect(store.updatePostProcessStep).not.toHaveBeenCalled();
    expect(input).toHaveValue(15);

    fireEvent.blur(input);
    await waitFor(() =>
      expect(store.updatePostProcessStep).toHaveBeenCalledWith({
        processId: activeProcessWithPendingStep.id,
        expectedRevisao: activeProcessWithPendingStep.revisao,
        ordem: 1,
        responsavelId: 4,
        prazoEfetivo: computeDeadlineDate('2026-09-10T00:00:00Z', 15, 'uteis').toISOString(),
        prazoDias: 15,
        tipoPrazo: 'uteis',
      }),
    );
    expect(store.updatePostProcessStep).toHaveBeenCalledTimes(1);
  });

  it('blur sem mudança real não gasta revisão; valor não inteiro/fora de faixa é recusado', () => {
    store.updatePostProcessStep.mockResolvedValue({ ok: true, revisao: 2, step: {} });
    renderSection({ process: activeProcessWithPendingStep, membros: [] });
    openSection();
    const input = screen.getByLabelText('Dias da etapa Design');
    fireEvent.blur(input);
    expect(store.updatePostProcessStep).not.toHaveBeenCalled();

    // O parâmetro da RPC é `integer`: 2.5 e um valor de 10 dígitos nem entram
    // no rascunho (viravam erro de cast do PostgREST, fora da tabela de erros).
    fireEvent.change(input, { target: { value: '2.5' } });
    expect(input).toHaveValue(3);
    // O teto é 999, MUITO abaixo do que o servidor aceita: computeDeadlineDate
    // em 'uteis' itera uma vez por dia e roda a cada render do rascunho.
    fireEvent.change(input, { target: { value: '1000' } });
    expect(input).toHaveValue(3);
    fireEvent.change(input, { target: { value: '2147483648' } });
    expect(input).toHaveValue(3);
  });

  // O Radix Select abre no pointerdown, que precede o blur do campo de dias:
  // sem serializar, o save do dropdown saía com a revisao velha das props e
  // o usuário levava um "process_changed" no fluxo mais natural do cluster.
  it('save do blur seguido do Select usa a revisao devolvida pelo primeiro (sem process_changed)', async () => {
    store.updatePostProcessStep
      .mockResolvedValueOnce({ ok: true, revisao: 2, step: {} })
      .mockResolvedValueOnce({ ok: true, revisao: 3, step: {} });
    renderSection({ process: activeProcessWithPendingStep, membros: [] });
    openSection();
    const input = screen.getByLabelText('Dias da etapa Design');
    const trigger = screen.getByRole('combobox', { name: 'Tipo de prazo da etapa Design' });

    fireEvent.change(input, { target: { value: '5' } });
    // Abrir o dropdown ANTES do blur é o que acontece de verdade: o Radix
    // abre no pointerdown, que precede o blur do campo.
    fireEvent.click(trigger);
    const option = await screen.findByRole('option', { name: 'Dias corridos' });
    fireEvent.blur(input); // save #1 dispara com o dropdown já aberto
    fireEvent.click(option); // save #2, item do portal segue clicável

    await waitFor(() => expect(store.updatePostProcessStep).toHaveBeenCalledTimes(2));
    expect(store.updatePostProcessStep.mock.calls[0][0]).toMatchObject({
      expectedRevisao: activeProcessWithPendingStep.revisao,
      prazoDias: 5,
      tipoPrazo: 'uteis',
    });
    expect(store.updatePostProcessStep.mock.calls[1][0]).toMatchObject({
      expectedRevisao: 2, // a revisao devolvida pelo primeiro save, não a das props
      tipoPrazo: 'corridos',
    });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('Enter grava sem esperar o blur manual', async () => {
    store.updatePostProcessStep.mockResolvedValue({ ok: true, revisao: 2, step: {} });
    renderSection({ process: activeProcessWithPendingStep, membros: [] });
    openSection();
    const input = screen.getByLabelText('Dias da etapa Design');
    // O handler de Enter chama `blur()`, e blur() só emite o evento se o
    // elemento estiver focado -- é o que acontece de verdade ao digitar.
    input.focus();
    fireEvent.change(input, { target: { value: '5' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() =>
      expect(store.updatePostProcessStep).toHaveBeenCalledWith({
        processId: activeProcessWithPendingStep.id,
        expectedRevisao: activeProcessWithPendingStep.revisao,
        ordem: 1,
        responsavelId: 4,
        prazoEfetivo: computeDeadlineDate('2026-09-10T00:00:00Z', 5, 'uteis').toISOString(),
        prazoDias: 5,
        tipoPrazo: 'uteis',
      }),
    );
  });

  it('trocar tipo_prazo (dias úteis → corridos) recalcula prazo_efetivo', async () => {
    store.updatePostProcessStep.mockResolvedValue({ ok: true, revisao: 2, step: {} });
    renderSection({ process: activeProcessWithPendingStep, membros: [] });
    openSection();
    fireEvent.click(screen.getByRole('combobox', { name: 'Tipo de prazo da etapa Design' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Dias corridos' }));
    await waitFor(() =>
      expect(store.updatePostProcessStep).toHaveBeenCalledWith(
        expect.objectContaining({
          prazoDias: 3,
          tipoPrazo: 'corridos',
          prazoEfetivo: computeDeadlineDate('2026-09-10T00:00:00Z', 3, 'corridos').toISOString(),
        }),
      ),
    );
  });

  it('etapa pendente: trocar responsável em modo dias reenvia prazoDias/tipoPrazo e recalcula prazo_efetivo', async () => {
    store.updatePostProcessStep.mockResolvedValue({ ok: true, revisao: 2, step: {} });
    const { qc } = renderSection({
      process: activeProcessWithPendingStep,
      membros: [
        { id: 4, nome: 'Ana' },
        { id: 9, nome: 'Bia' },
      ],
    });
    openSection();
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
        prazoEfetivo: computeDeadlineDate('2026-09-10T00:00:00Z', 3, 'uteis').toISOString(),
        prazoDias: 3,
        tipoPrazo: 'uteis',
      }),
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['post-process', activeProcessWithPendingStep.post_id],
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['post-processes'] });
  });

  it('sem iniciado_em: mostra "definida ao iniciar a etapa" e envia prazo_efetivo null', async () => {
    store.updatePostProcessStep.mockResolvedValue({ ok: true, revisao: 2, step: {} });
    renderSection({
      process: activeProcessPendingNotStarted,
      membros: [
        { id: 4, nome: 'Ana' },
        { id: 9, nome: 'Bia' },
      ],
    });
    openSection();
    expect(
      screen.getByRole('button', {
        name: 'definida ao iniciar a etapa: usar data fixa na etapa Design',
      }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('combobox', { name: 'Responsável da etapa Design' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Bia' }));
    await waitFor(() =>
      expect(store.updatePostProcessStep).toHaveBeenCalledWith(
        expect.objectContaining({
          responsavelId: 9,
          prazoEfetivo: null,
          prazoDias: 3,
          tipoPrazo: 'uteis',
        }),
      ),
    );
  });

  it('clicar na data calculada alterna para "data fixa"; editar a data manda prazoDias/tipoPrazo null', async () => {
    store.updatePostProcessStep.mockResolvedValue({ ok: true, revisao: 2, step: {} });
    renderSection({ process: activeProcessWithPendingStep, membros: [] });
    openSection();
    const expected = computeDeadlineDate('2026-09-10T00:00:00Z', 3, 'uteis');
    fireEvent.click(
      screen.getByRole('button', {
        name: `${formatEtapaDeadlineDay(expected)}: usar data fixa na etapa Design`,
      }),
    );

    // Modo "fixa": some o número/select, aparece o input de data + o link de volta.
    expect(screen.queryByLabelText('Dias da etapa Design')).not.toBeInTheDocument();
    const input = screen.getByLabelText('Prazo da etapa Design') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2026-09-25' } });
    await waitFor(() =>
      expect(store.updatePostProcessStep).toHaveBeenCalledWith(
        expect.objectContaining({
          prazoDias: null,
          tipoPrazo: null,
          prazoEfetivo: endOfLocalDay(parseLocalISODate('2026-09-25')!).toISOString(),
        }),
      ),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Usar dias na etapa Design' }));
    expect(screen.getByLabelText('Dias da etapa Design')).toBeInTheDocument();
    expect(screen.queryByLabelText('Prazo da etapa Design')).not.toBeInTheDocument();
  });

  it('rollback: falha step_not_editable → valor dos dias volta ao do servidor e toast mapeado', async () => {
    store.updatePostProcessStep.mockRejectedValueOnce({
      message: 'step_not_editable',
      code: 'P0001',
    });
    renderSection({ process: activeProcessWithPendingStep, membros: [] });
    openSection();
    const input = screen.getByLabelText('Dias da etapa Design') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '9' } });
    expect(input).toHaveValue(9); // optimistic: shows immediately, before the RPC resolves/fails
    fireEvent.blur(input);
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Só etapas pendentes ou em andamento podem ser editadas.',
      ),
    );
    await waitFor(() => expect(input).toHaveValue(3));
  });

  it('processo modo_prazo !== padrao mantém só o input de data (sem dias/tipo_prazo)', async () => {
    store.updatePostProcessStep.mockResolvedValue({ ok: true, revisao: 2, step: {} });
    renderSection({ process: nonPadraoProcess, membros: [] });
    openSection();
    expect(screen.queryByLabelText(/Dias da etapa/)).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /Tipo de prazo/ })).not.toBeInTheDocument();
    const input = screen.getByLabelText('Prazo da etapa Design') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2026-09-25' } });
    // Os quatro campos são setters absolutos na RPC de 7 parâmetros: omitir
    // prazo_dias/tipo_prazo grava NULL. Em `data_fixa`/`data_entrega` as
    // etapas também nascem com esses dois vindos do template
    // (apply_post_process), então a edição REENVIA os valores atuais -- é o
    // que garante "zero mudança de comportamento" nesses modos.
    await waitFor(() =>
      expect(store.updatePostProcessStep).toHaveBeenCalledWith({
        processId: nonPadraoProcess.id,
        expectedRevisao: nonPadraoProcess.revisao,
        ordem: 1,
        responsavelId: 4,
        prazoEfetivo: new Date(2026, 8, 25, 23, 59, 59, 999).toISOString(),
        prazoDias: nonPadraoProcess.steps[1].prazo_dias,
        tipoPrazo: nonPadraoProcess.steps[1].tipo_prazo,
      }),
    );
  });

  // Regressão: `stepMode` é zerado a cada revisao nova, então o default de
  // `modeOf` tem de sair dos DADOS. Com default fixo em 'dias', a etapa
  // salva como "data fixa" voltava ao editor de dias vazio no refetch
  // seguinte -- escondendo a data escolhida -- e a próxima edição de
  // responsável recalculava prazo_efetivo de prazo_dias=null, apagando-a.
  it('etapa já em data fixa (prazo_dias null + prazo_efetivo) abre em modo fixa, não dias', async () => {
    store.updatePostProcessStep.mockResolvedValue({ ok: true, revisao: 2, step: {} });
    renderSection({
      process: processoComEtapaEmDataFixa,
      membros: [
        { id: 4, nome: 'Ana' },
        { id: 9, nome: 'Bia' },
      ],
    });
    openSection();
    expect(screen.queryByLabelText('Dias da etapa Design')).not.toBeInTheDocument();
    const input = screen.getByLabelText('Prazo da etapa Design') as HTMLInputElement;
    expect(input.value).toBe(toLocalISODate(new Date(dataFixaIso)));

    // E editar o responsável NÃO pode apagar a data fixa.
    fireEvent.click(screen.getByRole('combobox', { name: 'Responsável da etapa Design' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Bia' }));
    await waitFor(() =>
      expect(store.updatePostProcessStep).toHaveBeenCalledWith(
        expect.objectContaining({
          responsavelId: 9,
          prazoEfetivo: dataFixaIso,
          prazoDias: null,
          tipoPrazo: null,
        }),
      ),
    );
  });

  it('etapas concluídas/herdadas/ignoradas e processo concluído não têm controles', () => {
    renderSection({ process: concludedProcess, membros: [] });
    openSection();
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(screen.queryAllByLabelText(/Prazo da etapa/)).toHaveLength(0);
  });

  it('etapa herdada de um processo ATIVO não tem controles', () => {
    renderSection({ process: activeProcessWithPendingStep, membros: [] });
    openSection();
    // A única etapa editável (Design) é padrão + modo dias por default:
    // responsável + tipo_prazo, 2 comboboxes, nenhum input de data solto.
    expect(screen.queryAllByRole('combobox')).toHaveLength(2);
    expect(screen.queryAllByLabelText(/Dias da etapa/)).toHaveLength(1);
    expect(screen.queryAllByLabelText(/Prazo da etapa/)).toHaveLength(0);
    expect(screen.getByText('Sem prazo')).toBeInTheDocument();
  });

  it('escolher "Sem responsável" manda responsavelId null', async () => {
    store.updatePostProcessStep.mockResolvedValue({ ok: true, revisao: 2, step: {} });
    renderSection({ process: activeProcessWithPendingStep, membros: [{ id: 4, nome: 'Ana' }] });
    openSection();
    fireEvent.click(screen.getByRole('combobox', { name: 'Responsável da etapa Design' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Sem responsável' }));
    await waitFor(() =>
      expect(store.updatePostProcessStep).toHaveBeenLastCalledWith(
        expect.objectContaining({ responsavelId: null }),
      ),
    );
  });

  it('editar uma etapa desabilita as demais até a RPC resolver (evita expectedRevisao obsoleto)', async () => {
    // Promise controlada à mão: o mock só resolve quando o teste manda,
    // simulando a janela em que a RPC da etapa 1 ainda está em voo.
    let resolveSave: (value: {
      ok: true;
      revisao: number;
      step: Record<string, unknown>;
    }) => void = () => {};
    store.updatePostProcessStep.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    renderSection({
      process: activeProcessWithTwoEditableSteps,
      membros: [
        { id: 4, nome: 'Ana' },
        { id: 9, nome: 'Bia' },
      ],
    });
    openSection();

    // Antes de qualquer edição, nenhum controle está desabilitado.
    expect(screen.getByRole('combobox', { name: 'Responsável da etapa Copy' })).not.toBeDisabled();
    expect(screen.getByLabelText('Dias da etapa Design')).not.toBeDisabled();

    // Edita a etapa 1 (Copy) sem esperar a RPC resolver.
    fireEvent.click(screen.getByRole('combobox', { name: 'Responsável da etapa Copy' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Bia' }));
    await waitFor(() => expect(store.updatePostProcessStep).toHaveBeenCalledTimes(1));

    // Enquanto a etapa 1 está salvando, TODOS os controles -- inclusive os
    // da etapa 2 -- ficam desabilitados, não só os da etapa que iniciou o save.
    expect(screen.getByRole('combobox', { name: 'Responsável da etapa Copy' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Responsável da etapa Design' })).toBeDisabled();
    expect(screen.getByLabelText('Dias da etapa Design')).toBeDisabled();

    // Resolve a RPC da etapa 1: os controles voltam a ficar habilitados.
    resolveSave({ ok: true, revisao: 2, step: {} });
    await waitFor(() =>
      expect(
        screen.getByRole('combobox', { name: 'Responsável da etapa Design' }),
      ).not.toBeDisabled(),
    );
    expect(screen.getByLabelText('Dias da etapa Design')).not.toBeDisabled();
  });

  it('recolhida por padrão: mostra o resumo de uma linha e nenhum history-timeline', () => {
    renderSection();
    const toggle = screen.getByRole('button', { name: /Produção/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // Resumo: etapa ativa (Design) · posição 2/3 · prazo curto · responsável.
    const summary = screen.getByText(/^Design · 2\/3 · 20 set/);
    expect(summary).toBeInTheDocument();
    expect(summary.textContent).toContain('Ana');
    expect(screen.queryByText('Copy')).not.toBeInTheDocument();
    expect(document.querySelector('.history-timeline')).not.toBeInTheDocument();
    // O histórico só alimenta o corpo (fora do DOM enquanto recolhida): a
    // query não deve nem disparar (busca real por post desnecessária a cada
    // drawer aberto com a seção recolhida, que é o padrão agora).
    expect(store.getPostProcessEvents).not.toHaveBeenCalled();
  });

  it('clicar no cabeçalho abre a seção (corpo passa a existir) e só então busca o histórico', async () => {
    renderSection();
    expect(store.getPostProcessEvents).not.toHaveBeenCalled();
    const toggle = screen.getByRole('button', { name: /Produção/ });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(document.querySelector('.history-timeline')).toBeInTheDocument();
    expect(screen.getByText('Copy')).toBeInTheDocument();
    await waitFor(() => expect(store.getPostProcessEvents).toHaveBeenCalledWith([77]));
  });

  it('processo concluído recolhido: resumo cai na última etapa, não na primeira', () => {
    renderSection({ process: concludedProcess, membros: [] });
    expect(screen.getByText(/^Design · 2\/2/)).toBeInTheDocument();
    expect(screen.queryByText(/^Copy · 1\/2/)).not.toBeInTheDocument();
  });

  it('a dica "cliente aprovou" aparece mesmo com a seção recolhida', () => {
    renderSection({
      process: activeProcessAguardandoCliente,
      membros: [],
      postStatus: 'aprovado_cliente',
    });
    expect(screen.getByRole('button', { name: /Produção/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.getByText('Cliente aprovou. Avançar etapa?')).toBeInTheDocument();
  });

  it('sessionStorage mantém a seção aberta entre remounts do mesmo post', () => {
    const { unmount } = renderSection();
    fireEvent.click(screen.getByRole('button', { name: /Produção/ }));
    expect(screen.getByText('Copy')).toBeInTheDocument();
    unmount();

    renderSection();
    expect(screen.getByRole('button', { name: /Produção/ })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByText('Copy')).toBeInTheDocument();
  });
});
