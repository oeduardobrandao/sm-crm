import { supabase } from './core';
import { membroMentionIds } from './comments';
import { syncMentions } from './mentions';

/** Same cap as the post discussion (DISCUSSAO_MAX_CHARS) and the table's CHECK. */
export const TAREFA_COMENTARIO_MAX_CHARS = 4000;

export interface TarefaComentario {
  id: number;
  conta_id: string;
  tarefa_id: number;
  /** NULL once the author's account is deleted: the thread stays, the UI says "Usuário removido". */
  author_id: string | null;
  /** Plain text with `@[Label](membro:id)` tokens. */
  conteudo: string;
  created_at: string;
  edited_at: string | null;
}

export type TarefaEventoTipo =
  | 'criada'
  | 'status'
  | 'responsavel'
  | 'prazo'
  | 'titulo'
  | 'descricao'
  | 'cliente'
  | 'recorrencia'
  | 'subtarefa_adicionada'
  | 'subtarefa_concluida'
  | 'subtarefa_reaberta'
  | 'subtarefa_removida'
  | 'tag_adicionada'
  | 'tag_removida';

/** One row of the task history, written only by database triggers (spec section 3). */
export interface TarefaEvento {
  id: number;
  tarefa_id: number;
  tipo: TarefaEventoTipo;
  /** NULL = system (recurrence cron, MCP updates). */
  actor_user_id: string | null;
  /** Snapshot of the actor's membro name at write time. */
  actor_nome: string | null;
  /** Shape depends on `tipo` (strings, `{id, nome}`, `{titulo}`, `{id, nome, cor}`...). */
  de: unknown;
  para: unknown;
  /** Transaction id: a tag remove + add pair in one transaction nets out in the timeline. */
  txid: number;
  created_at: string;
}

export async function getTarefaComentarios(tarefaId: number): Promise<TarefaComentario[]> {
  const { data, error } = await supabase
    .from('tarefa_comentarios')
    .select('*')
    .eq('tarefa_id', tarefaId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data as TarefaComentario[] | null) || [];
}

/**
 * Sends through the SECURITY DEFINER RPC, the only insert path: it checks the task's workspace,
 * parses the mentions server-side and notifies participants (`task_comment`).
 */
export async function enviarTarefaComentario(
  tarefaId: number,
  conteudo: string,
): Promise<TarefaComentario> {
  const { data, error } = await supabase.rpc('tarefa_comentario_enviar', {
    p_tarefa_id: tarefaId,
    p_conteudo: conteudo,
  });
  if (error) throw error;
  return data as TarefaComentario;
}

/** Author-only edit (RLS + column grant), then a mention re-sync so new mentions notify. */
export async function updateTarefaComentario(id: number, conteudo: string): Promise<void> {
  const { error } = await supabase.from('tarefa_comentarios').update({ conteudo }).eq('id', id);
  if (error) throw error;
  await syncMentions('tarefa_comentario', id, membroMentionIds(conteudo));
}

export async function deleteTarefaComentario(id: number): Promise<void> {
  const { error } = await supabase.from('tarefa_comentarios').delete().eq('id', id);
  if (error) throw error;
}

export async function getTarefaEventos(tarefaId: number): Promise<TarefaEvento[]> {
  const { data, error } = await supabase
    .from('tarefa_eventos')
    .select('*')
    .eq('tarefa_id', tarefaId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data as TarefaEvento[] | null) || [];
}
