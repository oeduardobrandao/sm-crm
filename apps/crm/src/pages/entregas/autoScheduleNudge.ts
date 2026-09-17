/**
 * As regras puras do aviso de agendamento automático (spec
 * docs/superpowers/specs/2026-09-17-manual-approval-auto-schedule-nudge-design.md).
 *
 * Deliberadamente SEM imports de runtime (nem `@/store`, nem serviços): vários
 * testes de componente mockam '@/store' inteiro com um factory estrito, e um
 * import de valor aqui morreria nesse proxy. Por isso `status` é tipado como
 * string e não como WorkflowPost['status'] -- o literal canônico está citado no
 * comentário de shouldOfferAutoSchedule.
 */

/** Piso do servidor: validateForScheduling rejeita scheduled_at a menos de 10
 *  minutos no futuro (supabase/functions/_shared/instagram-publish-utils.ts:86). */
export const SCHEDULE_MIN_FUTURE_MS = 10 * 60 * 1000;

/**
 * Margem de segurança sobre o piso do servidor (decisão 1 da spec, apontada pela
 * revisão do Codex): sem ela, uma confirmação feita no instante exato do limite
 * chega ao servidor alguns segundos depois já inválida e toma 422. A margem só
 * reduz a frequência disso; o servidor continua sendo a fonte de verdade.
 */
export const SCHEDULE_SAFETY_MARGIN_MS = 2 * 60 * 1000;

/**
 * True quando o post pode ir direto para o endpoint de agendamento sem pedir
 * uma data nova. `now` é injetável só para teste; a produção usa Date.now().
 */
export function isEligibleToScheduleNow(
  scheduledAt: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!scheduledAt) return false;
  const at = new Date(scheduledAt).getTime();
  if (Number.isNaN(at)) return false;
  return at >= now + SCHEDULE_MIN_FUTURE_MS + SCHEDULE_SAFETY_MARGIN_MS;
}

/**
 * True quando agendar este post passa pelo serviço do TikTok. Decisão 6 da spec:
 * `both` vai SÓ pelo TikTok (o servidor do TikTok valida os dois lados). Esta é a
 * única definição da regra no código — `scheduleApprovedPost` importa esta função
 * em vez de repetir a comparação, para que o gate de feature e o roteamento real
 * nunca possam divergir se uma plataforma nova aparecer.
 */
export function targetsTikTokService(platform: string | null | undefined): boolean {
  return platform === 'tiktok' || platform === 'both';
}

export interface AutoScheduleGateInput {
  /** Status canônico do post. Só 'aprovado_cliente' habilita o aviso. */
  status: string | null | undefined;
  /** post.platform. Decide se o gate de feature_tiktok se aplica. */
  platform: string | null | undefined;
  /** clientes.auto_publish_on_approval do cliente do post. */
  autoPublishOnApproval: boolean;
  /** useWorkspaceLimits().features?.feature_post_scheduling === true. */
  schedulingFeatureEnabled: boolean;
  /** useWorkspaceLimits().features?.feature_tiktok === true. */
  tiktokFeatureEnabled: boolean;
  /** isFinalClientApprovalCycle(etapas) do fluxo do post. */
  isFinalApprovalCycle: boolean;
}

/**
 * Os gates obrigatórios da spec (mais o status), num só lugar, para que as três
 * superfícies novas não divirjam. Qualquer um falso = nenhum aviso, nenhuma ação,
 * comportamento de hoje inalterado.
 *
 * Três gates são incondicionais (auto_publish_on_approval, feature_post_scheduling,
 * ciclo final de aprovação). O quarto é CONDICIONAL à plataforma: decisão 5 da spec
 * (correção do Codex) — `tiktok-publish/handler.ts:85-89` exige
 * `feature_post_scheduling` E `feature_tiktok` para a action `schedule`, enquanto
 * `instagram-publish/handler.ts:70-77` exige só o primeiro. Um workspace com
 * agendamento habilitado e sem o add-on de TikTok passaria pelos três primeiros
 * gates, veria o aviso, e tomaria 403 `feature_disabled` (`feature:
 * "feature_tiktok"`) ao confirmar. Por isso o gate de TikTok só morde quando o
 * post realmente vai por aquele endpoint.
 */
export function shouldOfferAutoSchedule(input: AutoScheduleGateInput): boolean {
  return (
    input.status === 'aprovado_cliente' &&
    input.autoPublishOnApproval &&
    input.schedulingFeatureEnabled &&
    input.isFinalApprovalCycle &&
    (!targetsTikTokService(input.platform) || input.tiktokFeatureEnabled)
  );
}

export interface SchedulePartition<T> {
  /** Já têm data futura com margem: podem ser agendados num clique. */
  eligible: T[];
  /** Sem data ou com data inelegível: precisam de uma data nova antes. */
  missingDate: T[];
}

/** Divide uma lista de posts aprovados nos dois grupos do diálogo de lote. */
export function partitionByScheduleEligibility<T extends { scheduled_at: string | null }>(
  posts: T[],
  now: number = Date.now(),
): SchedulePartition<T> {
  const eligible: T[] = [];
  const missingDate: T[] = [];
  for (const post of posts) {
    if (isEligibleToScheduleNow(post.scheduled_at, now)) eligible.push(post);
    else missingDate.push(post);
  }
  return { eligible, missingDate };
}
