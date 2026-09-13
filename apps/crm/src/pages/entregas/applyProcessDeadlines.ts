import type { StepOverrides, WorkflowTemplate } from '../../store';
import { computeDeadlineDate, computeDeliveryDeadlines } from './hooks/useEntregasData';
import { endOfLocalDay, parseLocalISODate } from '@/utils/postDate';

export type ModoPrazo = 'padrao' | 'data_fixa' | 'data_entrega';

export interface ApplyPlanInput {
  template: WorkflowTemplate;
  startOrdem: number;
  now: Date;
  fixedDates: Record<number, string | undefined>;
  deliveryDate: Date | null;
  clienteHasDiaEntrega: boolean;
  responsaveis: Record<number, number | null | undefined>;
}

export interface ApplyPlanStep {
  ordem: number;
  nome: string;
  tipo: 'padrao' | 'aprovacao_cliente';
  estado: 'ignorado' | 'ativo' | 'pendente';
  responsavelId: number | null;
  prazoEfetivo: string | null;
}

export interface ApplyPlan {
  modo: ModoPrazo;
  steps: ApplyPlanStep[];
  overrides: StepOverrides;
  blockers: string[];
  needsApprovalStep: boolean;
}

/**
 * Tudo que o diálogo "Aplicar processo" mostra e envia (spec §5.2, §7). A
 * sequência vem do template (ordem = índice do array, a mesma convenção de
 * buildTemplateFingerprint); do cliente só responsável e prazo_efetivo por
 * ordem >= inicial. `blockers` vazio = botão de confirmar habilitado.
 * - padrao: só a etapa inicial recebe prazo (de `now`); as futuras ganham
 *   prazo ao serem ativadas (transition_post_process com p_next_deadline).
 * - data_fixa: data por etapa >= inicial, obrigatória (step_deadline_required).
 * - data_entrega: aprovação do cliente a partir da inicial, dia do cliente e
 *   mês; prazos materializados por computeDeliveryDeadlines (fuso local).
 */
export function buildApplyPlan(input: ApplyPlanInput): ApplyPlan {
  const { template, startOrdem, now } = input;
  const modo: ModoPrazo = template.modo_prazo ?? 'padrao';
  const etapas = Array.isArray(template.etapas) ? template.etapas : [];
  const blockers: string[] = [];
  if (etapas.length === 0) blockers.push('Este modelo não tem etapas.');
  if (!Number.isInteger(startOrdem) || startOrdem < 0 || startOrdem >= etapas.length) {
    blockers.push('Escolha a etapa inicial.');
  }
  const fromStart = etapas
    .map((e, i) => ({
      ordem: i,
      tipo: e.tipo ?? 'padrao',
      prazo_dias: e.prazo_dias,
      tipo_prazo: e.tipo_prazo,
    }))
    .filter((e) => e.ordem >= startOrdem);
  const needsApprovalStep =
    modo === 'data_entrega' && !fromStart.some((e) => e.tipo === 'aprovacao_cliente');

  const prazoByOrdem = new Map<number, string | null>();
  if (blockers.length === 0) {
    if (modo === 'padrao') {
      const start = etapas[startOrdem];
      prazoByOrdem.set(
        startOrdem,
        computeDeadlineDate(now.toISOString(), start.prazo_dias, start.tipo_prazo).toISOString(),
      );
    } else if (modo === 'data_fixa') {
      for (const e of fromStart) {
        const raw = input.fixedDates[e.ordem];
        const d = raw ? parseLocalISODate(raw) : null;
        if (!d) blockers.push(`Informe a data da etapa "${etapas[e.ordem].nome}".`);
        else prazoByOrdem.set(e.ordem, endOfLocalDay(d).toISOString());
      }
    } else {
      if (!input.clienteHasDiaEntrega)
        blockers.push('O cliente não tem dia de entrega configurado.');
      else if (!input.deliveryDate) blockers.push('Escolha o mês de entrega.');
      if (needsApprovalStep) {
        blockers.push(
          'O modelo precisa de uma etapa de aprovação do cliente a partir da etapa inicial.',
        );
      }
      if (blockers.length === 0 && input.deliveryDate) {
        const map = computeDeliveryDeadlines(fromStart, input.deliveryDate);
        for (const e of fromStart) {
          const day = map.get(e.ordem);
          const d = day ? parseLocalISODate(day) : null;
          if (!d)
            blockers.push(`Não foi possível calcular a data da etapa "${etapas[e.ordem].nome}".`);
          else prazoByOrdem.set(e.ordem, endOfLocalDay(d).toISOString());
        }
      }
    }
  }

  const steps: ApplyPlanStep[] = etapas.map((e, i) => {
    const override = input.responsaveis[i];
    // Só para exibição no diálogo (mostra o responsável do template
    // pré-selecionado): o envio ao RPC é decidido abaixo, à parte.
    const responsavelId = override === undefined ? (e.responsavel_id ?? null) : override;
    return {
      ordem: i,
      nome: e.nome,
      tipo: e.tipo ?? 'padrao',
      estado: i < startOrdem ? 'ignorado' : i === startOrdem ? 'ativo' : 'pendente',
      responsavelId,
      prazoEfetivo: prazoByOrdem.get(i) ?? null,
    };
  });

  const overrides: StepOverrides = {};
  for (const s of steps) {
    if (s.ordem < startOrdem) continue;
    const userOverride = input.responsaveis[s.ordem];
    overrides[String(s.ordem)] =
      // Sem override do usuário: omite a chave e deixa apply_post_process usar
      // o próprio fallback dele (responsavel_id do template só se ainda
      // resolver para um membro da conta; senão null). Enviar aqui o
      // responsavel_id bruto do template forçaria membro_not_found sempre que
      // ele já tiver saído da equipe, bloqueando "Aplicar processo" inteiro
      // por um membro que o usuário nem tocou (achado de review, fase 4 final).
      userOverride === undefined
        ? { prazo_efetivo: s.prazoEfetivo }
        : { responsavel_id: userOverride, prazo_efetivo: s.prazoEfetivo };
  }
  return { modo, steps, overrides, blockers, needsApprovalStep };
}
