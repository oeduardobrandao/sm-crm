import type { Cliente, Membro, WorkflowTemplate } from '../../../store';
import { defaultEtapa, type EtapaFormData } from '../components/SortableEtapaList';
import type { WorkflowPreset } from './presets';
import { getIntlLocale, i18n, SUPPORTED_LANGUAGES } from '@mesaas/i18n';

/** suggestionId → its name key under `workflows:presets.etapas`. */
const SUGGESTION_KEYS = {
  briefing: 'briefing',
  roteiro: 'roteiro',
  redacao: 'redacao',
  criacao: 'criacao',
  design: 'design',
  'revisao-interna': 'revisaoInterna',
  'aprovacao-cliente': 'aprovacaoCliente',
  ajustes: 'ajustes',
  agendamento: 'agendamento',
  publicacao: 'publicacao',
  relatorio: 'relatorio',
} as const;

type SuggestionId = keyof typeof SUGGESTION_KEYS;

export interface SuggestedEtapa {
  readonly suggestionId: SuggestionId;
  /** Resolved in the current UI language on every read (a getter), never at module load. */
  readonly nome: string;
  readonly tipo: 'padrao' | 'aprovacao_cliente';
  readonly prazo: number;
  readonly tipoPrazo: 'uteis' | 'corridos';
}

const etapaName = (id: SuggestionId, lng?: string) =>
  i18n.t(`workflows:presets.etapas.${SUGGESTION_KEYS[id]}`, lng ? { lng } : undefined);

const sug = (
  suggestionId: SuggestionId,
  tipo: SuggestedEtapa['tipo'],
  prazo: number,
  tipoPrazo: SuggestedEtapa['tipoPrazo'],
): SuggestedEtapa => ({
  suggestionId,
  get nome() {
    return etapaName(suggestionId);
  },
  tipo,
  prazo,
  tipoPrazo,
});

export const SUGGESTED_ETAPAS: readonly SuggestedEtapa[] = [
  sug('briefing', 'padrao', 2, 'uteis'),
  sug('roteiro', 'padrao', 2, 'uteis'),
  sug('redacao', 'padrao', 3, 'uteis'),
  sug('criacao', 'padrao', 4, 'uteis'),
  sug('design', 'padrao', 3, 'uteis'),
  sug('revisao-interna', 'padrao', 1, 'uteis'),
  sug('aprovacao-cliente', 'aprovacao_cliente', 3, 'corridos'),
  sug('ajustes', 'padrao', 2, 'uteis'),
  sug('agendamento', 'padrao', 1, 'uteis'),
  sug('publicacao', 'padrao', 1, 'uteis'),
  sug('relatorio', 'padrao', 2, 'uteis'),
];

/** Normalize for name → suggestionId matching. */
const norm = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

/** Matches a stored etapa name against the suggestion names in every UI language, so a
 *  template saved in Portuguese still binds while the CRM is in English (and vice versa). */
function bindSuggestion(nome: string): string | undefined {
  const target = norm(nome);
  for (const s of SUGGESTED_ETAPAS) {
    for (const lng of SUPPORTED_LANGUAGES) {
      if (norm(etapaName(s.suggestionId, lng)) === target) return s.suggestionId;
    }
  }
  return undefined;
}

export function etapasFromPreset(preset: WorkflowPreset): EtapaFormData[] {
  return preset.etapas.map((e) =>
    defaultEtapa({
      nome: e.nome,
      prazo: e.prazo_dias,
      tipoPrazo: e.tipo_prazo,
      tipo: e.tipo,
      responsavelId: null,
      suggestionId: bindSuggestion(e.nome),
    }),
  );
}

export function etapasFromTemplate(tpl: WorkflowTemplate): EtapaFormData[] {
  return tpl.etapas.map((e) =>
    defaultEtapa({
      nome: e.nome,
      prazo: e.prazo_dias,
      tipoPrazo: e.tipo_prazo,
      tipo: e.tipo || 'padrao',
      responsavelId: e.responsavel_id || null,
      suggestionId: bindSuggestion(e.nome),
    }),
  );
}

export function suggestName(sourceNome: string, today: Date = new Date()): string {
  const next = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const label = next.toLocaleDateString(getIntlLocale(), { month: 'long', year: 'numeric' });
  return i18n.t('workflows:wizard.suggestedName', {
    source: sourceNome,
    month: `${label.charAt(0).toUpperCase()}${label.slice(1)}`,
  });
}

export function validateEtapas(
  etapas: EtapaFormData[],
  membros: Membro[],
): { rowErrors: Map<string, string>; globalError: string | null } {
  const named = etapas.filter((e) => e.nome.trim());
  if (named.length === 0) {
    return { rowErrors: new Map(), globalError: i18n.t('workflows:templatesModal.addOneStage') };
  }
  const memberIds = new Set(membros.map((m) => m.id));
  const rowErrors = new Map<string, string>();
  for (const e of named) {
    if (e.responsavelId == null) {
      rowErrors.set(e._id, i18n.t('workflows:wizard.selectAssignee'));
    } else if (!memberIds.has(e.responsavelId)) {
      rowErrors.set(e._id, i18n.t('workflows:wizard.assigneeGone'));
    }
  }
  return { rowErrors, globalError: null };
}

export function dataEntregaAvailability(
  etapas: EtapaFormData[],
  cliente: Cliente | undefined,
): { enabled: boolean; reason: string | null } {
  if (!etapas.some((e) => e.nome.trim() && e.tipo === 'aprovacao_cliente')) {
    return { enabled: false, reason: i18n.t('workflows:wizard.needsApprovalAnchor') };
  }
  if (!cliente?.dia_entrega) {
    return { enabled: false, reason: i18n.t('workflows:wizard.noDeliveryDay') };
  }
  return { enabled: true, reason: null };
}

export function countApprovals(etapas: EtapaFormData[]): number {
  return etapas.filter((e) => e.tipo === 'aprovacao_cliente').length;
}

export function validatePrazos(
  etapas: EtapaFormData[],
  modoPrazo: 'padrao' | 'data_fixa' | 'data_entrega',
): string | null {
  if (modoPrazo !== 'data_fixa') return null;
  const missing = etapas.filter((e) => e.nome.trim() && !e.dataLimite);
  return missing.length > 0 ? i18n.t('workflows:wizard.fixedDatesMissing') : null;
}

/** "3 posts" / "1 post", for the linha editorial seed copy. */
export function postsLabel(n: number): string {
  return i18n.t('workflows:wizard.postsLabel', { count: n });
}
