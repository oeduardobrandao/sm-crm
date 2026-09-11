import { supabase } from './core';
import { fetchAllPaged } from './paging';
import {
  POST_CONTEXT_COLUMNS,
  mapPostContextRow,
  callRpcWithDeadlockRetry,
  type ActivePost,
} from './posts';

// =============================================
// POST PROCESSES (processos individuais de produção)
// Spec: docs/superpowers/specs/2026-09-10-posts-individuais-fluxos-design.md §8.
// Tabelas: post_processes / post_process_steps / post_process_events
// (migration 20260918000002). SELECT liberado por RLS para membros da conta;
// Leitura em lote (fase 3) e, a partir da fase 4, os invólucros das sete RPCs
// SECURITY DEFINER da fase 2 (migrations 20260919000003..8). Nenhuma escrita
// direta nas três tabelas: RLS bloqueia `authenticated`, só as RPCs escrevem.
// Prazos (`p_active_deadline`, `p_step_deadlines`, `prazo_efetivo` dos
// overrides, `p_next_deadline`) são calculados pelo CRM e só armazenados pela
// RPC (spec §7). Todas passam por callRpcWithDeadlockRetry; o `requestId` do
// desmembrar em lote vem do chamador para que a repetição por 40P01 reenvie o
// mesmo id (spec §9.4).
// =============================================

export type PostProcessEstado = 'ativo' | 'concluido' | 'encerrado';
export type PostProcessStepEstado =
  | 'pendente'
  | 'ativo'
  | 'concluido'
  | 'herdado'
  | 'ignorado'
  | 'interrompido';

export interface PostProcessStep {
  id: number;
  conta_id: string;
  process_id: number;
  ordem: number;
  nome: string;
  tipo: 'padrao' | 'aprovacao_cliente';
  responsavel_id: number | null;
  prazo_dias: number | null;
  tipo_prazo: 'uteis' | 'corridos' | null;
  /** Prazo congelado da etapa (timestamptz). Vence sobre prazo_dias/tipo_prazo. */
  prazo_efetivo: string | null;
  estado: PostProcessStepEstado;
  iniciado_em: string | null;
  concluido_em: string | null;
  interrompido_em: string | null;
  origem_etapa_ordem: number | null;
  origem_etapa_nome: string | null;
}

export interface PostProcess {
  id: number;
  conta_id: string;
  post_id: number;
  template_id: number | null;
  template_nome: string | null;
  assinatura: string;
  origem_workflow_id: number | null;
  origem_descricao: string | null;
  estado: PostProcessEstado;
  motivo_encerramento: 'removido' | 'vinculado' | null;
  etapa_atual: number;
  modo_prazo: 'padrao' | 'data_fixa' | 'data_entrega';
  /** Mesmo espaço de índices de workflows.position (spec §4.2). */
  board_position: number;
  revisao: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  concluido_em: string | null;
  /** Ordenadas por `ordem` ascendente. */
  steps: PostProcessStep[];
}

export interface PostProcessWithPost extends PostProcess {
  /** Resumo do post (POST_CONTEXT_COLUMNS, sem conteúdo rico), no formato de
   *  getActivePosts -- workflow_id é sempre null enquanto o processo é vigente. */
  post: ActivePost;
}

export type PostProcessEvento =
  | 'desmembrado'
  | 'aplicado'
  | 'avancou'
  | 'voltou'
  | 'concluido'
  | 'reaberto'
  | 'removido'
  | 'vinculado'
  | 'etapa_editada';

export interface PostProcessEvent {
  id: number;
  conta_id: string;
  post_id: number;
  process_id: number;
  evento: PostProcessEvento;
  actor_user_id: string | null;
  actor_name: string | null;
  origem: 'workspace_user' | 'system';
  antes: Record<string, unknown> | null;
  depois: Record<string, unknown> | null;
  created_at: string;
}

const PROCESS_COLUMNS =
  'id, conta_id, post_id, template_id, template_nome, assinatura, origem_workflow_id, origem_descricao, estado, motivo_encerramento, etapa_atual, modo_prazo, board_position, revisao, created_by, created_at, updated_at, concluido_em';

const STEP_COLUMNS =
  'id, conta_id, process_id, ordem, nome, tipo, responsavel_id, prazo_dias, tipo_prazo, prazo_efetivo, estado, iniciado_em, concluido_em, interrompido_em, origem_etapa_ordem, origem_etapa_nome';

// Embeds nomeados pela constraint (FKs compostas de tenant, migration
// 20260918000002): post_process_steps_process_same_tenant e
// post_processes_post_same_tenant. O post vem no formato do braço avulso de
// getActivePosts (clientes(nome) direto na linha), que mapPostContextRow já lê.
// O teste unitário mocka a cadeia e não exercita o hint; quem o valida é a
// checagem em staging (Task 15, Step 6). Se o PostgREST rejeitar o sufixo
// `!constraint`, remova só o sufixo (`post_process_steps(...)` e
// `workflow_posts(...)`): cada embed tem exatamente UM caminho de FK
// (post_processes.post_id só tem a FK composta; steps idem com process_id).
const STEPS_EMBED = `post_process_steps!post_process_steps_process_same_tenant(${STEP_COLUMNS})`;
const POST_EMBED = `workflow_posts!post_processes_post_same_tenant(${POST_CONTEXT_COLUMNS}, clientes(nome))`;

const VIGENTES: PostProcessEstado[] = ['ativo', 'concluido'];

function sortSteps(steps: PostProcessStep[] | null | undefined): PostProcessStep[] {
  return [...(steps ?? [])].sort((a, b) => a.ordem - b.ordem);
}

function mapProcessRow(row: any): PostProcess {
  const { post_process_steps, ...proc } = row;
  return { ...proc, steps: sortSteps(post_process_steps) };
}

function mapProcessWithPostRow(row: any): PostProcessWithPost {
  const { workflow_posts, ...rest } = row;
  return { ...mapProcessRow(rest), post: mapPostContextRow(workflow_posts) };
}

/**
 * Todos os processos VIGENTES da conta (ativo + concluido) numa consulta só,
 * com etapas e resumo do post embutidos (spec §8.3). Os ativos viram cards do
 * quadro; os concluídos entram em Concluídas; o conjunto inteiro é a exclusão
 * da seção Sem processo (§4.3, §8.2). Encerrados não aparecem em lugar nenhum
 * do quadro e ficam de fora. Paginado por segurança (max-rows silencioso do
 * PostgREST); RLS aplica conta_id.
 */
export async function getVigentePostProcesses(): Promise<PostProcessWithPost[]> {
  const rows = await fetchAllPaged(async (from, to) => {
    const { data, error } = await supabase
      .from('post_processes')
      .select(`${PROCESS_COLUMNS}, ${STEPS_EMBED}, ${POST_EMBED}`)
      .in('estado', VIGENTES)
      .order('board_position', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to);
    if (error) throw error;
    return (data ?? []) as any[];
  });
  return rows.map(mapProcessWithPostRow);
}

/** O processo vigente de um post (no máximo um, índice parcial
 *  post_processes_one_vigente_per_post), sem o embed do post. Para o drawer. */
export async function getVigentePostProcess(postId: number): Promise<PostProcess | null> {
  const { data, error } = await supabase
    .from('post_processes')
    .select(`${PROCESS_COLUMNS}, ${STEPS_EMBED}`)
    .eq('post_id', postId)
    .in('estado', VIGENTES)
    .maybeSingle();
  if (error) throw error;
  return data ? mapProcessRow(data) : null;
}

/** Histórico de processo dos posts pedidos, em lote (mesmo desenho de
 *  getPostStatusEvents). Inclui eventos de processos já encerrados. */
export async function getPostProcessEvents(postIds: number[]): Promise<PostProcessEvent[]> {
  if (postIds.length === 0) return [];
  const { data, error } = await supabase
    .from('post_process_events')
    .select(
      'id, conta_id, post_id, process_id, evento, actor_user_id, actor_name, origem, antes, depois, created_at',
    )
    .in('post_id', postIds)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw error;
  return (data ?? []) as PostProcessEvent[];
}

// ── RPCs de mutação (fase 4) ─────────────────────────────────────────────────

/** Linha de etapa como as RPCs a devolvem em `steps`/`step`. */
export interface RpcStepRow {
  process_id: number;
  ordem: number;
  nome: string;
  tipo: 'padrao' | 'aprovacao_cliente';
  estado: PostProcessStepEstado;
  responsavel_id: number | null;
  prazo_dias: number | null;
  tipo_prazo: 'uteis' | 'corridos' | null;
  prazo_efetivo: string | null;
  iniciado_em: string | null;
  concluido_em?: string | null;
}

export interface DetachKeepingProcessArgs {
  postIds: number[];
  workflowId: number;
  /** buildFingerprint(workflow, allEtapas) sobre os dados exibidos. */
  fingerprint: string;
  /** Prazo congelado da etapa ativa da origem, ISO (spec §7). */
  activeDeadline: string;
  /** uuid gerado pelo diálogo; regenerado quando a seleção ou o checkbox de
   *  arquivar mudam (os dois entram no input_hash do servidor). */
  requestId: string;
  /** {"<ordem>": "<ISO>"} das etapas futuras com data_limite na origem. */
  stepDeadlines?: Record<string, string> | null;
  archiveEmptyFlow?: boolean;
}

export interface DetachKeepingProcessResult {
  ok: true;
  request_id: string;
  detached: number;
  archived_workflow_ids: number[];
  processes: {
    process_id: number;
    post_id: number;
    etapa_atual: number;
    revisao: number;
    board_position: number;
    assinatura: string;
    origem_workflow_id: number | null;
    origem_descricao: string | null;
  }[];
  steps: RpcStepRow[];
}

export async function detachPostsKeepingProcess(
  args: DetachKeepingProcessArgs,
): Promise<DetachKeepingProcessResult> {
  return callRpcWithDeadlockRetry<DetachKeepingProcessResult>(() =>
    supabase.rpc('detach_posts_keeping_process', {
      p_post_ids: args.postIds,
      p_workflow_id: args.workflowId,
      p_fingerprint: args.fingerprint,
      p_active_deadline: args.activeDeadline,
      p_request_id: args.requestId,
      p_step_deadlines: args.stepDeadlines ?? null,
      p_archive_empty_flow: args.archiveEmptyFlow ?? false,
    }),
  );
}

/** Por `ordem` (chave em string de dígitos), só as duas chaves que a RPC aceita. */
export type StepOverrides = Record<
  string,
  { responsavel_id?: number | null; prazo_efetivo?: string | null }
>;

export interface ApplyPostProcessArgs {
  postId: number;
  templateId: number;
  /** buildTemplateFingerprint(template.etapas). */
  templateFingerprint: string;
  startOrdem: number;
  stepOverrides?: StepOverrides | null;
}

export interface ApplyPostProcessResult {
  ok: true;
  process_id: number;
  post_id: number;
  estado: 'ativo';
  etapa_atual: number;
  revisao: number;
  assinatura: string;
  template_id: number;
  template_nome: string;
  steps: RpcStepRow[];
}

export async function applyPostProcess(
  args: ApplyPostProcessArgs,
): Promise<ApplyPostProcessResult> {
  return callRpcWithDeadlockRetry<ApplyPostProcessResult>(() =>
    supabase.rpc('apply_post_process', {
      p_post_id: args.postId,
      p_template_id: args.templateId,
      p_template_fingerprint: args.templateFingerprint,
      p_start_ordem: args.startOrdem,
      p_step_overrides: args.stepOverrides ?? null,
    }),
  );
}

export type ProcessCommand = 'avancar' | 'voltar' | 'concluir' | 'reabrir';
/** Decisão 13 da fase 2: "enviar ao cliente" NÃO é transição. */
export type ApprovalChoice = 'aprovar_interno' | 'sem_alterar';

export interface TransitionPostProcessArgs {
  processId: number;
  expectedRevisao: number;
  command: ProcessCommand;
  approvalChoice?: ApprovalChoice | null;
  /** Obrigatório em avancar/concluir sobre etapa aprovacao_cliente. */
  expectedPostStatus?: string | null;
  /** Só em avancar, e só quando a próxima etapa tem prazo relativo sem prazo_efetivo. */
  nextDeadline?: string | null;
}

export interface TransitionPostProcessResult {
  ok: true;
  process_id: number;
  post_id: number;
  command: ProcessCommand;
  estado: PostProcessEstado;
  etapa_atual: number;
  revisao: number;
  post_status: string;
  post_status_changed: boolean;
  steps: RpcStepRow[];
}

export async function transitionPostProcess(
  args: TransitionPostProcessArgs,
): Promise<TransitionPostProcessResult> {
  return callRpcWithDeadlockRetry<TransitionPostProcessResult>(() =>
    supabase.rpc('transition_post_process', {
      p_process_id: args.processId,
      p_expected_revisao: args.expectedRevisao,
      p_command: args.command,
      p_approval_choice: args.approvalChoice ?? null,
      p_expected_post_status: args.expectedPostStatus ?? null,
      p_next_deadline: args.nextDeadline ?? null,
    }),
  );
}

export interface UpdatePostProcessStepArgs {
  processId: number;
  expectedRevisao: number;
  ordem: number;
  /** Setters absolutos: null limpa. A UI manda sempre os dois valores. */
  responsavelId: number | null;
  prazoEfetivo: string | null;
}

export interface UpdatePostProcessStepResult {
  ok: true;
  process_id: number;
  ordem: number;
  revisao: number;
  step: RpcStepRow;
}

export async function updatePostProcessStep(
  args: UpdatePostProcessStepArgs,
): Promise<UpdatePostProcessStepResult> {
  return callRpcWithDeadlockRetry<UpdatePostProcessStepResult>(() =>
    supabase.rpc('update_post_process_step', {
      p_process_id: args.processId,
      p_expected_revisao: args.expectedRevisao,
      p_ordem: args.ordem,
      p_responsavel_id: args.responsavelId,
      p_prazo_efetivo: args.prazoEfetivo,
    }),
  );
}

export interface RemovePostProcessResult {
  ok: true;
  process_id: number;
  post_id: number;
  estado: 'encerrado';
  motivo_encerramento: 'removido';
  revisao: number;
}

export async function removePostProcess(
  processId: number,
  expectedRevisao: number,
): Promise<RemovePostProcessResult> {
  return callRpcWithDeadlockRetry<RemovePostProcessResult>(() =>
    supabase.rpc('remove_post_process', {
      p_process_id: processId,
      p_expected_revisao: expectedRevisao,
    }),
  );
}

export interface AttachClosingProcessResult {
  ok: true;
  process_id: number;
  post_id: number;
  workflow_id: number;
  estado: 'encerrado';
  motivo_encerramento: 'vinculado';
  revisao: number;
}

export async function attachPostClosingProcess(
  postId: number,
  workflowId: number,
  expectedRevisao: number,
): Promise<AttachClosingProcessResult> {
  return callRpcWithDeadlockRetry<AttachClosingProcessResult>(() =>
    supabase.rpc('attach_post_closing_process', {
      p_post_id: postId,
      p_workflow_id: workflowId,
      p_expected_revisao: expectedRevisao,
    }),
  );
}

export interface ReorderFluxosBoardArgs {
  workflowIds: number[];
  workflowPositions: number[];
  processIds: number[];
  processPositions: number[];
}

/** Coluna inteira, ids mistos, um único espaço de índices (spec §4.2). A RPC
 *  rejeita arrays de comprimentos diferentes, id/posição repetidos e os dois
 *  vazios com invalid_arguments; o chamador nunca envia coluna vazia. */
export async function reorderFluxosBoard(args: ReorderFluxosBoardArgs): Promise<void> {
  await callRpcWithDeadlockRetry<null>(() =>
    supabase.rpc('reorder_fluxos_board', {
      p_workflow_ids: args.workflowIds,
      p_workflow_positions: args.workflowPositions,
      p_process_ids: args.processIds,
      p_process_positions: args.processPositions,
    }),
  );
}
