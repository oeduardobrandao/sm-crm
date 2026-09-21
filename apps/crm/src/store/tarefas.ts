import { supabase, getUserId, getContaId } from './core';
import {
  extractMentionsFromDoc,
  extractMentionsFromText,
} from '@/components/mentions/mentionTokens';
import { syncMentions } from './mentions';

function membroMentionIds(text: string, richDoc?: Record<string, unknown> | null): number[] {
  return (richDoc ? extractMentionsFromDoc(richDoc) : extractMentionsFromText(text))
    .filter((ref) => ref.entityType === 'membro')
    .map((ref) => ref.id);
}

export type TarefaStatus = 'pendente' | 'em_andamento' | 'concluida';

export interface Tarefa {
  id?: number;
  user_id?: string;
  conta_id?: string;
  titulo: string;
  descricao?: string | null;
  descricao_rich?: Record<string, unknown> | null;
  status: TarefaStatus;
  responsavel_id?: number | null;
  cliente_id?: number | null;
  /** 'YYYY-MM-DD' */
  data_limite?: string | null;
  /** timestamptz ISO. Owned by the DB trigger; never written from the client. */
  concluida_em?: string | null;
  /** Series this occurrence belongs to. Linked/unlinked only by the series RPCs. */
  serie_id?: number | null;
  created_at?: string;
  updated_at?: string;
}

export interface Subtarefa {
  id?: number;
  tarefa_id: number;
  conta_id?: string;
  titulo: string;
  concluida: boolean;
  ordem: number;
  created_at?: string;
}

export interface TarefaTag {
  id?: number;
  conta_id?: string;
  nome: string;
  cor: string;
  created_at?: string;
}

export type TarefaSerieFreq = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type TarefaSerieModo = 'ao_concluir' | 'calendario';

/** The repeat rule as the RPCs receive it (p_serie / p_regra). */
export interface TarefaSerieRegra {
  freq: TarefaSerieFreq;
  intervalo: number;
  /** 0 = Sunday .. 6 = Saturday. Weekly only, else null. */
  dias_semana: number[] | null;
  /** Landing day (monthly, yearly), else null. Never derived from `inicio`. */
  dia_mes: number | null;
  /** Landing month (yearly), else null. */
  mes: number | null;
  modo: TarefaSerieModo;
  /** 'YYYY-MM-DD', inclusive, or null = never ends. */
  fim: string | null;
}

/** What getTarefas() embeds per occurrence. */
export interface TarefaSerieResumo extends TarefaSerieRegra {
  id: number;
  inicio: string;
  pausada: boolean;
  encerrada_em: string | null;
  proxima_data: string | null;
}

export type TarefaSeriePayload = Pick<
  Tarefa,
  | 'titulo'
  | 'descricao'
  | 'descricao_rich'
  | 'status'
  | 'responsavel_id'
  | 'cliente_id'
  | 'data_limite'
>;

export type TarefaSerieEstadoVerbo = 'pausar' | 'retomar' | 'encerrar';

export interface TarefaWithRelations extends Tarefa {
  tags: TarefaTag[];
  subtarefas_total: number;
  subtarefas_concluidas: number;
  cliente_nome: string | null;
  cliente_cor: string | null;
  serie: TarefaSerieResumo | null;
}

interface TarefaRow extends Tarefa {
  clientes: { nome: string; cor: string } | null;
  tarefa_tag_links: { tarefa_tags: TarefaTag | null }[] | null;
  subtarefas: { id: number; concluida: boolean }[] | null;
  tarefa_series: TarefaSerieResumo | null;
}

export async function getTarefas(): Promise<TarefaWithRelations[]> {
  const { data, error } = await supabase
    .from('tarefas')
    .select(
      '*, clientes(nome, cor), tarefa_tag_links(tarefa_tags(id, nome, cor)), subtarefas(id, concluida), tarefa_series(id, freq, intervalo, dias_semana, dia_mes, mes, modo, inicio, fim, pausada, encerrada_em, proxima_data)',
    )
    .order('created_at', { ascending: false });
  if (error) throw error;
  return ((data as TarefaRow[]) || []).map((row) => {
    const { clientes, tarefa_tag_links, subtarefas, tarefa_series, ...tarefa } = row;
    const subs = subtarefas || [];
    return {
      ...tarefa,
      tags: (tarefa_tag_links || [])
        .map((l) => l.tarefa_tags)
        .filter((t): t is TarefaTag => t != null),
      subtarefas_total: subs.length,
      subtarefas_concluidas: subs.filter((s) => s.concluida).length,
      cliente_nome: clientes?.nome ?? null,
      cliente_cor: clientes?.cor ?? null,
      serie: tarefa_series ?? null,
    };
  });
}

export async function addTarefa(
  t: Omit<Tarefa, 'id' | 'user_id' | 'conta_id' | 'concluida_em' | 'created_at' | 'updated_at'>,
  tagIds: number[] = [],
): Promise<Tarefa> {
  const user_id = await getUserId();
  const conta_id = await getContaId();
  const { data, error } = await supabase
    .from('tarefas')
    .insert({ ...t, user_id, conta_id })
    .select()
    .single();
  if (error) throw error;
  if (tagIds.length > 0) {
    const { error: linkError } = await supabase
      .from('tarefa_tag_links')
      .insert(tagIds.map((tag_id) => ({ tarefa_id: data.id, tag_id, conta_id })));
    if (linkError) throw linkError;
  }
  await syncMentions('tarefa', data.id, membroMentionIds(t.descricao ?? '', t.descricao_rich));
  return data;
}

export async function updateTarefa(
  id: number,
  patch: Partial<Omit<Tarefa, 'id' | 'user_id' | 'conta_id' | 'concluida_em'>>,
): Promise<Tarefa> {
  const { data, error } = await supabase
    .from('tarefas')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  if ('descricao' in patch || 'descricao_rich' in patch) {
    await syncMentions('tarefa', id, membroMentionIds(patch.descricao ?? '', patch.descricao_rich));
  }
  return data;
}

export async function deleteTarefa(id: number): Promise<void> {
  const { error } = await supabase.from('tarefas').delete().eq('id', id);
  if (error) throw error;
}

/** Replaces the task's tag set (delete-all + re-insert: simplest correct diff). */
export async function setTarefaTags(tarefaId: number, tagIds: number[]): Promise<void> {
  const conta_id = await getContaId();
  const { error: delError } = await supabase
    .from('tarefa_tag_links')
    .delete()
    .eq('tarefa_id', tarefaId);
  if (delError) throw delError;
  if (tagIds.length > 0) {
    const { error } = await supabase
      .from('tarefa_tag_links')
      .insert(tagIds.map((tag_id) => ({ tarefa_id: tarefaId, tag_id, conta_id })));
    if (error) throw error;
  }
}

// ---- Subtarefas ----

export async function getSubtarefas(tarefaId: number): Promise<Subtarefa[]> {
  const { data, error } = await supabase
    .from('subtarefas')
    .select('*')
    .eq('tarefa_id', tarefaId)
    .order('ordem', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function addSubtarefa(
  s: Omit<Subtarefa, 'id' | 'conta_id' | 'created_at'>,
): Promise<Subtarefa> {
  const conta_id = await getContaId();
  const { data, error } = await supabase
    .from('subtarefas')
    .insert({ ...s, conta_id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function toggleSubtarefa(id: number, concluida: boolean): Promise<void> {
  const { error } = await supabase.from('subtarefas').update({ concluida }).eq('id', id);
  if (error) throw error;
}

export async function deleteSubtarefa(id: number): Promise<void> {
  const { error } = await supabase.from('subtarefas').delete().eq('id', id);
  if (error) throw error;
}

// ---- Tags ----

export async function getTarefaTags(): Promise<TarefaTag[]> {
  const { data, error } = await supabase
    .from('tarefa_tags')
    .select('*')
    .order('nome', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function addTarefaTag(
  t: Omit<TarefaTag, 'id' | 'conta_id' | 'created_at'>,
): Promise<TarefaTag> {
  const conta_id = await getContaId();
  const { data, error } = await supabase
    .from('tarefa_tags')
    .insert({ ...t, conta_id })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateTarefaTag(
  id: number,
  patch: Partial<Pick<TarefaTag, 'nome' | 'cor'>>,
): Promise<TarefaTag> {
  const { data, error } = await supabase
    .from('tarefa_tags')
    .update(patch)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteTarefaTag(id: number): Promise<void> {
  const { error } = await supabase.from('tarefa_tags').delete().eq('id', id);
  if (error) throw error;
}

// ---- Series (tarefas recorrentes) ----
// Every write goes through a SECURITY DEFINER RPC; the store never touches
// tarefa_series directly (the table is SELECT-only for authenticated).

/** Creates a series and its first occurrence atomically. With `tarefaId`, promotes
 *  that standalone open task instead (its subtasks are snapshotted server-side).
 *  Mentions are synced best-effort AFTER the RPC (syncMentions never throws). */
export async function criarTarefaSerie(
  regra: TarefaSerieRegra,
  tarefa: TarefaSeriePayload,
  tagIds: number[],
  subtarefas: string[],
  tarefaId?: number,
): Promise<{ serie_id: number; tarefa_id: number }> {
  const { data, error } = await supabase.rpc('tarefa_serie_criar', {
    p_serie: regra,
    p_tarefa: tarefa,
    p_tag_ids: tagIds,
    p_subtarefas: subtarefas,
    p_tarefa_id: tarefaId ?? null,
  });
  if (error) throw error;
  const row = (data as { serie_id: number; tarefa_id: number }[])[0];
  await syncMentions(
    'tarefa',
    row.tarefa_id,
    membroMentionIds(tarefa.descricao ?? '', tarefa.descricao_rich),
  );
  return row;
}

/** "Esta e as próximas": full occurrence payload + full tag set + whole rule, no diffing.
 *  `encerrar = true` is "Não repete": ends the series and detaches this occurrence. */
export async function aplicarEdicaoSerie(
  tarefaId: number,
  tarefa: TarefaSeriePayload,
  tagIds: number[],
  regra: TarefaSerieRegra,
  encerrar: boolean,
): Promise<void> {
  const { error } = await supabase.rpc('tarefa_serie_aplicar_edicao', {
    p_tarefa_id: tarefaId,
    p_tarefa: tarefa,
    p_tag_ids: tagIds,
    p_regra: regra,
    p_encerrar: encerrar,
  });
  if (error) throw error;
  await syncMentions(
    'tarefa',
    tarefaId,
    membroMentionIds(tarefa.descricao ?? '', tarefa.descricao_rich),
  );
}

export async function definirEstadoSerie(
  serieId: number,
  verbo: TarefaSerieEstadoVerbo,
): Promise<void> {
  const { error } = await supabase.rpc('tarefa_serie_definir_estado', {
    p_serie_id: serieId,
    p_estado: verbo,
  });
  if (error) throw error;
}

/** "Toda a série": ends, deletes open occurrences, deletes the series; completed ones stay as standalone tasks. */
export async function deleteTarefaSerieCompleta(serieId: number): Promise<void> {
  const { error } = await supabase.rpc('tarefa_serie_excluir', { p_serie_id: serieId });
  if (error) throw error;
}

function pgErrorMatches(e: unknown, code: string, constraint: string): boolean {
  if (!e || typeof e !== 'object') return false;
  const { code: c, message } = e as { code?: unknown; message?: unknown };
  return c === code && typeof message === 'string' && message.includes(constraint);
}

/** 23505 on tarefas_serie_data_uq: another occurrence of the same series already has that date. */
export function isSerieDateConflict(e: unknown): boolean {
  return pgErrorMatches(e, '23505', 'tarefas_serie_data_uq');
}

/** 23514 on tarefas_serie_exige_prazo: an occurrence cannot lose its due date. */
export function isSerieSemPrazo(e: unknown): boolean {
  return pgErrorMatches(e, '23514', 'tarefas_serie_exige_prazo');
}
