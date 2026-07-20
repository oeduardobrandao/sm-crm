import type { Cliente, Membro, Workflow, WorkflowTemplate } from '../../../store';
import { addWorkflow, addWorkflowEtapa, addWorkflowTemplate, removeWorkflow } from '../../../store';
import { computeDeliveryDeadlines, getNextDeliveryDate } from '../hooks/useEntregasData';
import type { EtapaFormData } from '../components/SortableEtapaList';

export type WizardSource =
  | { kind: 'preset'; presetId: string; presetNome: string }
  | { kind: 'template'; templateId: number; templateNome: string }
  | { kind: 'zero' };

export interface WizardCreateInput {
  clienteId: number;
  titulo: string;
  recorrente: boolean;
  modoPrazo: 'padrao' | 'data_fixa' | 'data_entrega';
  mesEntrega: string;
  etapas: EtapaFormData[];
  source: WizardSource;
  saveAsTemplate: boolean;
  templateName: string;
  cliente: Cliente | undefined;
  membros: Membro[];
}

function deliveryDeadlines(input: WizardCreateInput, valid: EtapaFormData[]) {
  if (input.modoPrazo !== 'data_entrega' || !input.cliente?.dia_entrega) return null;
  // State stores '' for "próximo mês disponível"; '__auto__' is the Select's sentinel and must
  // never leak here — normalize defensively so it can't parse as an invalid YYYY-MM.
  const mes = input.mesEntrega === '__auto__' ? '' : input.mesEntrega;
  let deliveryDate: Date;
  if (mes) {
    const [yr, mo] = mes.split('-').map(Number);
    const lastDay = new Date(yr, mo, 0).getDate();
    deliveryDate = new Date(yr, mo - 1, Math.min(input.cliente.dia_entrega, lastDay));
  } else {
    deliveryDate = getNextDeliveryDate(input.cliente.dia_entrega);
  }
  const mock = valid.map((e, i) => ({
    id: i,
    workflow_id: 0,
    ordem: i,
    nome: e.nome,
    prazo_dias: e.prazo,
    tipo_prazo: e.tipoPrazo,
    responsavel_id: e.responsavelId,
    tipo: e.tipo,
    status: 'pendente' as const,
    iniciado_em: null,
    concluido_em: null,
  }));
  return computeDeliveryDeadlines(mock, deliveryDate);
}

export async function createWorkflowFromWizard(
  input: WizardCreateInput,
): Promise<{ workflow: Workflow; template?: WorkflowTemplate; warning?: string }> {
  const valid = input.etapas.filter((e) => e.nome.trim());

  // 1. Template first — a failure here must never block fluxo creation.
  let template: WorkflowTemplate | undefined;
  let warning: string | undefined;
  if (input.saveAsTemplate && input.templateName.trim()) {
    try {
      template = await addWorkflowTemplate({
        nome: input.templateName.trim(),
        modo_prazo: input.modoPrazo,
        etapas: valid.map((e) => ({
          nome: e.nome,
          prazo_dias: e.prazo,
          tipo_prazo: e.tipoPrazo,
          responsavel_id: e.responsavelId,
          tipo: e.tipo,
        })),
      });
    } catch {
      warning = 'O fluxo será criado, mas não foi possível salvar o template.';
    }
  }

  const templateId =
    template?.id ?? (input.source.kind === 'template' ? input.source.templateId : null);

  // 2. Workflow + etapas (same semantics as the legacy modal, incl. orphan cleanup).
  const deadlines = deliveryDeadlines(input, valid);
  const memberIds = new Set(input.membros.map((m) => m.id));
  const workflow = await addWorkflow({
    cliente_id: input.clienteId,
    titulo: input.titulo,
    template_id: templateId,
    status: 'ativo',
    etapa_atual: 0,
    recorrente: input.recorrente,
    modo_prazo: input.modoPrazo,
  });
  try {
    const now = new Date().toISOString();
    for (let i = 0; i < valid.length; i++) {
      const e = valid[i];
      let dataLimite: string | null = null;
      if (input.modoPrazo === 'data_fixa') dataLimite = e.dataLimite || null;
      else if (deadlines) dataLimite = deadlines.get(i) || null;
      await addWorkflowEtapa({
        workflow_id: workflow.id!,
        ordem: i,
        nome: e.nome,
        prazo_dias: e.prazo,
        tipo_prazo: e.tipoPrazo,
        tipo: e.tipo,
        responsavel_id: e.responsavelId && memberIds.has(e.responsavelId) ? e.responsavelId : null,
        status: i === 0 ? 'ativo' : 'pendente',
        iniciado_em: i === 0 ? now : null,
        concluido_em: null,
        data_limite: dataLimite,
      });
    }
  } catch (err) {
    try {
      await removeWorkflow(workflow.id!); // template intentionally kept
    } catch {
      /* best effort */
    }
    throw err;
  }

  return { workflow, template, warning };
}
