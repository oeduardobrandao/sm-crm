import { supabase } from './core';

// Agenda (eventos da equipe). Thin wrappers over the agenda_* RPCs; the
// database owns recurrence, materialization, masking and permissions.
// Spec: docs/superpowers/specs/2026-10-05-agenda-eventos-core-design.md

export type AgendaTipo = 'reuniao' | 'gravacao' | 'captacao' | 'apresentacao' | 'interno' | 'outro';
export type AgendaCor =
  | 'azul'
  | 'rosa'
  | 'laranja'
  | 'roxo'
  | 'verde'
  | 'teal'
  | 'cinza'
  | 'amarelo';
export type AgendaResposta = 'pendente' | 'sim' | 'nao' | 'talvez';
export type AgendaEscopo = 'esta' | 'seguintes' | 'todas';

/** Recurrence rule. Weekdays use 0 = domingo; weeks start on Monday (WKST=MO). */
export interface AgendaRegra {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  intervalo: number;
  dias_semana: number[] | null;
  mensal_modo: 'dia_mes' | 'dia_semana' | null;
  mensal_ordinal: 1 | 2 | 3 | 4 | -1 | null;
  /** yyyy-mm-dd, inclusive, local date in the series tz. */
  ate: string | null;
  contagem: number | null;
}

export interface AgendaParticipante {
  user_id: string;
  /** null on masked (private) events: who is busy is shown, not their answer. */
  resposta: AgendaResposta | null;
}

/** One row of agenda_listar. */
export interface AgendaOcorrencia {
  ocorrencia_id: number;
  evento_id: number;
  data_original: string;
  /** ISO instants with offset. */
  inicio: string;
  fim: string;
  dia_inteiro: boolean;
  /** yyyy-mm-dd in the series tz; fim is exclusive. Used for all-day events. */
  data_inicio_local: string;
  data_fim_local: string;
  titulo: string;
  descricao: string | null;
  local: string | null;
  link_reuniao: string | null;
  tipo: AgendaTipo | null;
  cor: AgendaCor | null;
  cliente_id: number | null;
  cliente_nome: string | null;
  privado: boolean;
  mascarado: boolean;
  recorrente: boolean;
  regra: AgendaRegra | null;
  /** null when masked. */
  lembretes: number[] | null;
  organizador_id: string | null;
  participantes: AgendaParticipante[];
  minha_resposta: AgendaResposta | null;
  pode_editar: boolean;
  pode_responder: boolean;
  tz: string;
}

/** p_evento for agenda_evento_criar / agenda_evento_editar. `tz` only on create
 *  (immutable afterwards). inicio_local/fim_local are wall clock in the series
 *  tz, 'yyyy-MM-ddTHH:mm:ss'; all-day uses 00:00 and an exclusive end date. */
export interface AgendaEventoPayload {
  titulo: string;
  descricao: string | null;
  local: string | null;
  link_reuniao: string | null;
  tipo: AgendaTipo;
  cor: AgendaCor | null;
  cliente_id: number | null;
  privado: boolean;
  dia_inteiro: boolean;
  tz?: string;
  inicio_local: string;
  fim_local: string;
  lembretes: number[];
  regra: AgendaRegra | null;
}

export const AGENDA_QUERY_KEY = 'agenda-ocorrencias';

export async function listAgenda(de: Date, ate: Date): Promise<AgendaOcorrencia[]> {
  const { data, error } = await supabase.rpc('agenda_listar', {
    p_de: de.toISOString(),
    p_ate: ate.toISOString(),
  });
  if (error) throw error;
  return (data as AgendaOcorrencia[] | null) ?? [];
}

/** Deep link / form prefill. The row carries regra, lembretes and participants. */
export async function getAgendaOcorrencia(id: number): Promise<AgendaOcorrencia | null> {
  const { data, error } = await supabase.rpc('agenda_listar', { p_ocorrencia_id: id });
  if (error) throw error;
  return (data as AgendaOcorrencia[] | null)?.[0] ?? null;
}

export async function criarEvento(
  p: AgendaEventoPayload,
  participantes: string[],
): Promise<{ evento_id: number; ocorrencia_id: number | null; dtstart: string }> {
  const { data, error } = await supabase.rpc('agenda_evento_criar', {
    p_evento: p,
    p_participantes: participantes,
  });
  if (error) throw error;
  const row = (
    data as { evento_id: number; ocorrencia_id: number | null; dtstart: string }[] | null
  )?.[0];
  if (!row) throw new Error('agenda_evento_criar returned no row');
  return row;
}

/** Returns the id of the occurrence that represents the edited one. A key
 *  absent from `p` keeps the stored value (drag sends only inicio_local/fim_local). */
export async function editarEvento(
  ocorrenciaId: number,
  escopo: AgendaEscopo,
  p: Partial<AgendaEventoPayload>,
  participantes: string[] | null,
): Promise<number | null> {
  const { data, error } = await supabase.rpc('agenda_evento_editar', {
    p_ocorrencia_id: ocorrenciaId,
    p_escopo: escopo,
    p_evento: p,
    p_participantes: participantes,
  });
  if (error) throw error;
  return data as number | null;
}

export async function excluirEvento(ocorrenciaId: number, escopo: AgendaEscopo): Promise<void> {
  const { error } = await supabase.rpc('agenda_evento_excluir', {
    p_ocorrencia_id: ocorrenciaId,
    p_escopo: escopo,
  });
  if (error) throw error;
}

export async function responderEvento(
  ocorrenciaId: number,
  resposta: Exclude<AgendaResposta, 'pendente'>,
  escopo: 'esta' | 'todas',
): Promise<void> {
  const { error } = await supabase.rpc('agenda_responder', {
    p_ocorrencia_id: ocorrenciaId,
    p_resposta: resposta,
    p_escopo: escopo,
  });
  if (error) throw error;
}

const AGENDA_ERRO_GENERICO = 'Não foi possível salvar o evento. Tente novamente.';

/** True for the RPCs' 'agenda: este evento não existe mais' (the occurrence or
 *  series is gone). Reads the message like formatAgendaError does. */
export function ehAgendaNaoExiste(e: unknown): boolean {
  const message =
    e && typeof e === 'object' && typeof (e as { message?: unknown }).message === 'string'
      ? (e as { message: string }).message
      : null;
  if (!message) return false;
  return /^agenda:\s*este evento não existe mais\.?$/i.test(message.trim());
}

/** 'agenda: x' (RAISE from the agenda RPCs) -> 'X'; anything else -> generic copy.
 *  Accepts Error instances and PostgrestError-like `{ message }` objects. */
export function formatAgendaError(err: unknown): string {
  const message =
    err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string'
      ? (err as { message: string }).message
      : null;
  if (!message) return AGENDA_ERRO_GENERICO;
  const m = /^agenda:\s*(.+)$/is.exec(message.trim());
  if (!m) return AGENDA_ERRO_GENERICO;
  const texto = m[1].trim();
  if (!texto) return AGENDA_ERRO_GENERICO;
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
