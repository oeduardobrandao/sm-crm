import type { PostStatusCounts, WorkflowPost } from '@/store/posts';
import type { Workflow, WorkflowEtapa } from '@/store/workflows';
import type { PostProcessEstado, PostProcessStep } from '@/store/postProcesses';

export type ApprovalExitOption = 'manter' | 'aprovar' | 'voltar_rascunho' | 'enviar_portal';

type PostStatus = WorkflowPost['status'];

/** Posts que já passaram da aprovação do cliente ou já saíram do alcance dela. */
const CLEARED: ReadonlySet<PostStatus> = new Set([
  'aprovado_cliente',
  'agendado',
  'postado',
  'falha_publicacao',
]);
/** Posts que não voltam (nem já estão) para rascunho. */
const NOT_RESETTABLE: ReadonlySet<PostStatus> = new Set([
  'rascunho',
  'agendado',
  'postado',
  'falha_publicacao',
]);

export function fluxoExitOptions(input: {
  counts: PostStatusCounts;
  isLastEtapa: boolean;
  temAprovacaoAdiante: boolean;
}): {
  options: ApprovalExitOption[];
  recommended: ApprovalExitOption;
  pendentes: number;
  alteraveisRascunho: number;
  aprovadoInterno: number;
} {
  let pendentes = 0;
  let alteraveisRascunho = 0;
  for (const [status, n] of Object.entries(input.counts) as [PostStatus, number | undefined][]) {
    const count = n ?? 0;
    if (!CLEARED.has(status)) pendentes += count;
    if (!NOT_RESETTABLE.has(status)) alteraveisRascunho += count;
  }
  const aprovadoInterno = input.counts.aprovado_interno ?? 0;

  const options: ApprovalExitOption[] = ['manter'];
  if (pendentes > 0) options.push('aprovar');
  if (alteraveisRascunho > 0 && !input.isLastEtapa) options.push('voltar_rascunho');
  if (aprovadoInterno > 0) options.push('enviar_portal');

  const recommended: ApprovalExitOption =
    options.includes('voltar_rascunho') && input.temAprovacaoAdiante ? 'voltar_rascunho' : 'manter';
  return { options, recommended, pendentes, alteraveisRascunho, aprovadoInterno };
}

export function postExitOptions(input: {
  status: PostStatus;
  command: 'avancar' | 'concluir';
  temAprovacaoAdiante: boolean;
  sendDisabledReason?: string;
}): { options: ApprovalExitOption[]; recommended: ApprovalExitOption; locked: boolean } {
  const locked = input.status === 'agendado' || input.status === 'postado';
  const options: ApprovalExitOption[] = ['manter'];
  if (locked) return { options, recommended: 'manter', locked };

  if (!CLEARED.has(input.status)) options.push('aprovar');
  if (!NOT_RESETTABLE.has(input.status) && input.command === 'avancar') {
    options.push('voltar_rascunho');
  }
  if (!CLEARED.has(input.status) && !input.sendDisabledReason) options.push('enviar_portal');

  const recommended: ApprovalExitOption =
    options.includes('voltar_rascunho') && input.temAprovacaoAdiante ? 'voltar_rascunho' : 'manter';
  return { options, recommended, locked };
}

type BannerResult = { show: false } | { show: true; ciclo: string };

interface BannerStep {
  ordem: number;
  tipo?: 'padrao' | 'aprovacao_cliente';
  /** Normalizado: pendente | ativo | concluido | outro. */
  state: string;
  concluido_em?: string | null;
}

function bannerFromSteps(
  steps: BannerStep[],
  dispensadoEm: string | null | undefined,
): BannerResult {
  const ativo = steps.find((s) => s.state === 'ativo');
  if (!ativo || (ativo.tipo ?? 'padrao') !== 'padrao') return { show: false };

  const concluidasAntes = steps.filter(
    (s) => s.tipo === 'aprovacao_cliente' && s.state === 'concluido' && s.ordem < ativo.ordem,
  );
  if (concluidasAntes.length === 0) return { show: false };
  const temAdiante = steps.some((s) => s.tipo === 'aprovacao_cliente' && s.ordem > ativo.ordem);
  if (!temAdiante) return { show: false };

  let ciclo: string | null = null;
  let cicloMs = -Infinity;
  for (const s of concluidasAntes) {
    if (!s.concluido_em) continue;
    const ms = new Date(s.concluido_em).getTime();
    if (Number.isNaN(ms)) continue;
    if (ms > cicloMs) {
      cicloMs = ms;
      ciclo = s.concluido_em;
    }
  }
  if (ciclo === null) return { show: false };

  if (dispensadoEm) {
    const dMs = new Date(dispensadoEm).getTime();
    if (!Number.isNaN(dMs) && dMs >= cicloMs) return { show: false };
  }
  return { show: true, ciclo };
}

export function fluxoRascunhoBanner(input: {
  etapas: WorkflowEtapa[];
  approvedCount: number;
  dispensadoEm: string | null | undefined;
  workflowStatus: Workflow['status'];
}): BannerResult {
  if (input.workflowStatus !== 'ativo' || input.approvedCount <= 0) return { show: false };
  return bannerFromSteps(
    input.etapas.map((e) => ({
      ordem: e.ordem,
      tipo: e.tipo,
      state: e.status,
      concluido_em: e.concluido_em,
    })),
    input.dispensadoEm,
  );
}

export function postRascunhoBanner(input: {
  steps: PostProcessStep[];
  estado: PostProcessEstado;
  postStatus: PostStatus;
  dispensadoEm: string | null;
}): BannerResult {
  if (input.estado !== 'ativo' || input.postStatus !== 'aprovado_cliente') return { show: false };
  return bannerFromSteps(
    input.steps.map((s) => ({
      ordem: s.ordem,
      tipo: s.tipo,
      state: s.estado,
      concluido_em: s.concluido_em,
    })),
    input.dispensadoEm,
  );
}
