import { supabase, getUserId, getContaId } from './core';
import { extractMentionsFromText } from '@/components/mentions/mentionTokens';
import { syncMentions } from './mentions';

function membroMentionIds(text: string): number[] {
  return extractMentionsFromText(text)
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
  status: TarefaStatus;
  responsavel_id?: number | null;
  cliente_id?: number | null;
  /** 'YYYY-MM-DD' */
  data_limite?: string | null;
  /** timestamptz ISO. Owned by the DB trigger; never written from the client. */
  concluida_em?: string | null;
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

export interface TarefaWithRelations extends Tarefa {
  tags: TarefaTag[];
  subtarefas_total: number;
  subtarefas_concluidas: number;
  cliente_nome: string | null;
}

interface TarefaRow extends Tarefa {
  clientes: { nome: string } | null;
  tarefa_tag_links: { tarefa_tags: TarefaTag | null }[] | null;
  subtarefas: { id: number; concluida: boolean }[] | null;
}

export async function getTarefas(): Promise<TarefaWithRelations[]> {
  const { data, error } = await supabase
    .from('tarefas')
    .select(
      '*, clientes(nome), tarefa_tag_links(tarefa_tags(id, nome, cor)), subtarefas(id, concluida)',
    )
    .order('created_at', { ascending: false });
  if (error) throw error;
  return ((data as TarefaRow[]) || []).map((row) => {
    const { clientes, tarefa_tag_links, subtarefas, ...tarefa } = row;
    const subs = subtarefas || [];
    return {
      ...tarefa,
      tags: (tarefa_tag_links || [])
        .map((l) => l.tarefa_tags)
        .filter((t): t is TarefaTag => t != null),
      subtarefas_total: subs.length,
      subtarefas_concluidas: subs.filter((s) => s.concluida).length,
      cliente_nome: clientes?.nome ?? null,
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
  await syncMentions('tarefa', data.id, membroMentionIds(t.descricao ?? ''));
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
  if ('descricao' in patch) {
    await syncMentions('tarefa', id, membroMentionIds(patch.descricao ?? ''));
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
