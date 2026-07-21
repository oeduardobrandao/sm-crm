import type { Cliente, Membro, WorkflowTemplate } from '../../../store';
import { defaultEtapa, type EtapaFormData } from '../components/SortableEtapaList';
import type { WorkflowPreset } from './presets';

export const SUGGESTED_ETAPAS = [
  { suggestionId: 'briefing', nome: 'Briefing', tipo: 'padrao', prazo: 2, tipoPrazo: 'uteis' },
  { suggestionId: 'roteiro', nome: 'Roteiro', tipo: 'padrao', prazo: 2, tipoPrazo: 'uteis' },
  { suggestionId: 'redacao', nome: 'Redação', tipo: 'padrao', prazo: 3, tipoPrazo: 'uteis' },
  { suggestionId: 'criacao', nome: 'Criação', tipo: 'padrao', prazo: 4, tipoPrazo: 'uteis' },
  { suggestionId: 'design', nome: 'Design', tipo: 'padrao', prazo: 3, tipoPrazo: 'uteis' },
  {
    suggestionId: 'revisao-interna',
    nome: 'Revisão interna',
    tipo: 'padrao',
    prazo: 1,
    tipoPrazo: 'uteis',
  },
  {
    suggestionId: 'aprovacao-cliente',
    nome: 'Aprovação do cliente',
    tipo: 'aprovacao_cliente',
    prazo: 3,
    tipoPrazo: 'corridos',
  },
  { suggestionId: 'ajustes', nome: 'Ajustes', tipo: 'padrao', prazo: 2, tipoPrazo: 'uteis' },
  {
    suggestionId: 'agendamento',
    nome: 'Agendamento',
    tipo: 'padrao',
    prazo: 1,
    tipoPrazo: 'uteis',
  },
  { suggestionId: 'publicacao', nome: 'Publicação', tipo: 'padrao', prazo: 1, tipoPrazo: 'uteis' },
  { suggestionId: 'relatorio', nome: 'Relatório', tipo: 'padrao', prazo: 2, tipoPrazo: 'uteis' },
] as const satisfies readonly {
  suggestionId: string;
  nome: string;
  tipo: 'padrao' | 'aprovacao_cliente';
  prazo: number;
  tipoPrazo: 'uteis' | 'corridos';
}[];

/** Normalize for name → suggestionId matching (load-time only). */
const norm = (s: string) => s.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const suggestionByName = new Map(SUGGESTED_ETAPAS.map((s) => [norm(s.nome), s.suggestionId]));

function bindSuggestion(nome: string): string | undefined {
  return suggestionByName.get(norm(nome));
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
  const label = next.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return `${sourceNome} — ${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

export function validateEtapas(
  etapas: EtapaFormData[],
  membros: Membro[],
): { rowErrors: Map<string, string>; globalError: string | null } {
  const named = etapas.filter((e) => e.nome.trim());
  if (named.length === 0) {
    return { rowErrors: new Map(), globalError: 'Adicione pelo menos uma etapa.' };
  }
  const memberIds = new Set(membros.map((m) => m.id));
  const rowErrors = new Map<string, string>();
  for (const e of named) {
    if (e.responsavelId == null) {
      rowErrors.set(e._id, 'Selecione um responsável para esta etapa.');
    } else if (!memberIds.has(e.responsavelId)) {
      rowErrors.set(e._id, 'Responsável não existe mais — selecione outro.');
    }
  }
  return { rowErrors, globalError: null };
}

export function dataEntregaAvailability(
  etapas: EtapaFormData[],
  cliente: Cliente | undefined,
): { enabled: boolean; reason: string | null } {
  if (!etapas.some((e) => e.nome.trim() && e.tipo === 'aprovacao_cliente')) {
    return { enabled: false, reason: 'Requer uma etapa de Aprovação do cliente como âncora.' };
  }
  if (!cliente?.dia_entrega) {
    return { enabled: false, reason: 'O cliente não tem um dia de entrega configurado.' };
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
  return missing.length > 0
    ? 'Defina uma data limite para todas as etapas no modo Datas fixas.'
    : null;
}
