import { supabase } from './core';
import { _computeDeliveryDeadlines, type WorkflowEtapa, type WorkflowTemplate } from './workflows';
import type { TemplatePropertyDefinition } from './posts';

export interface MigrationEtapaInput {
  nome: string;
  prazo_dias: number;
  tipo_prazo: 'uteis' | 'corridos';
  responsavel_id: number | null;
  tipo: 'padrao' | 'aprovacao_cliente';
  data_limite: string | null;
}

export interface PropertyMatch {
  origem: TemplatePropertyDefinition;
  destino: TemplatePropertyDefinition | null;
}

// mesmo charset do btrim(..., E' \t\r\n') da RPC: paridade exata entre prévia e escrita
const normalize = (name: string) => name.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '').toLowerCase();

/** Tipos cujos valores guardam ids de opção gerados por template (config.options[].id):
 *  um remap apontaria para uma opção inexistente no destino, então nunca casam. */
export const OPTION_TYPES = new Set(['select', 'multiselect', 'status']);

/**
 * Espelha a regra de remapeamento da RPC migrate_workflow_template: mesmo nome
 * (case-insensitive, trim) e mesmo tipo; select/multiselect/status nunca casam;
 * empate resolvido por menor display_order, depois menor id. Usada só na PRÉVIA
 * do diálogo — a escrita real acontece na RPC.
 */
export function matchPropertyDefinitions(
  origem: TemplatePropertyDefinition[],
  destino: TemplatePropertyDefinition[],
): PropertyMatch[] {
  return origem.map((o) => {
    if (OPTION_TYPES.has(o.type)) return { origem: o, destino: null };
    const candidates = destino
      .filter((d) => d.type === o.type && normalize(d.name) === normalize(o.name))
      .sort((a, b) => a.display_order - b.display_order || (a.id ?? 0) - (b.id ?? 0));
    return { origem: o, destino: candidates[0] ?? null };
  });
}

/**
 * Monta o payload p_new_etapas a partir do template destino. deliveryDate só
 * importa para modo_prazo 'data_entrega' (âncora aprovacao_cliente recebe a
 * data; demais recuam/avançam pelos prazos) — null deixa tudo sem data, o
 * mesmo comportamento do wizard quando o cliente não tem dia_entrega.
 */
export function buildMigrationEtapas(
  template: WorkflowTemplate,
  deliveryDate: Date | null,
): MigrationEtapaInput[] {
  const base: MigrationEtapaInput[] = template.etapas.map((e) => ({
    nome: e.nome,
    prazo_dias: e.prazo_dias,
    tipo_prazo: e.tipo_prazo,
    responsavel_id: e.responsavel_id ?? null,
    tipo: e.tipo ?? 'padrao',
    data_limite: null,
  }));

  if ((template.modo_prazo ?? 'padrao') === 'data_entrega' && deliveryDate) {
    const mock: WorkflowEtapa[] = base.map((e, i) => ({
      id: i,
      workflow_id: 0,
      ordem: i,
      nome: e.nome,
      prazo_dias: e.prazo_dias,
      tipo_prazo: e.tipo_prazo,
      responsavel_id: e.responsavel_id,
      tipo: e.tipo,
      status: 'pendente',
      iniciado_em: null,
      concluido_em: null,
    }));
    const deadlines = _computeDeliveryDeadlines(mock, deliveryDate);
    return base.map((e, i) => ({ ...e, data_limite: deadlines.get(i) ?? null }));
  }

  return base;
}

const MIGRATION_ERRORS: Record<string, string> = {
  workspace_not_found: 'Workspace não encontrado. Recarregue a página.',
  workflow_not_found: 'Fluxo não encontrado neste workspace.',
  workflow_changed:
    'Este fluxo foi alterado por outra pessoa. Recarregue a página e tente novamente.',
  workflow_not_active: 'Só é possível migrar fluxos ativos.',
  same_template: 'O fluxo já usa este template.',
  template_not_found: 'Template não encontrado neste workspace.',
  invalid_modo_prazo: 'Dados de migração inválidos.',
  empty_etapas: 'O template de destino não tem etapas.',
  invalid_active_ordem: 'Etapa atual inválida para o template de destino.',
  invalid_etapa: 'Dados de migração inválidos.',
  invalid_responsavel: 'Responsável inválido para este workspace.',
};

export function mapMigrationError(message: string): string {
  for (const [code, friendly] of Object.entries(MIGRATION_ERRORS)) {
    if (message.includes(code)) return friendly;
  }
  return 'Não foi possível migrar o template. Tente novamente.';
}

export async function migrateWorkflowTemplate(args: {
  workflowId: number;
  templateId: number;
  etapas: MigrationEtapaInput[];
  activeOrdem: number;
  modoPrazo: 'padrao' | 'data_fixa' | 'data_entrega';
  /** template_id que o cliente estava vendo (null para adoção); guarda de concorrência da RPC. */
  expectedTemplateId: number | null;
}): Promise<void> {
  const { error } = await supabase.rpc('migrate_workflow_template', {
    p_workflow_id: args.workflowId,
    p_template_id: args.templateId,
    p_new_etapas: args.etapas,
    p_active_ordem: args.activeOrdem,
    p_modo_prazo: args.modoPrazo,
    p_expected_template_id: args.expectedTemplateId,
  });
  if (error) throw new Error(mapMigrationError(error.message));
}
