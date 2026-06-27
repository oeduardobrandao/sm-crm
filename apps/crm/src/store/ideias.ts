import { supabase } from './core';

export interface IdeiaReaction {
  id: string;
  ideia_id: string;
  membro_id: number;
  emoji: string;
  created_at: string;
  membros: { nome: string };
}

export interface Ideia {
  id: string;
  workspace_id: string;
  cliente_id: number;
  titulo: string;
  descricao: string;
  links: string[];
  status: 'nova' | 'em_analise' | 'aprovada' | 'descartada';
  comentario_agencia: string | null;
  comentario_autor_id: number | null;
  comentario_at: string | null;
  created_at: string;
  updated_at: string;
  clientes: { nome: string };
  comentario_autor: { nome: string } | null;
  ideia_reactions: IdeiaReaction[];
  image_count: number;
}

export async function getIdeias(filters: { cliente_id?: number } = {}): Promise<Ideia[]> {
  let q = supabase
    .from('ideias')
    .select(
      `
      id, workspace_id, cliente_id, titulo, descricao, links, status,
      comentario_agencia, comentario_autor_id, comentario_at, created_at, updated_at,
      clientes(nome),
      comentario_autor:membros!comentario_autor_id(nome),
      ideia_reactions(id, ideia_id, membro_id, emoji, created_at, membros(nome)),
      ideia_files(count)
    `,
    )
    .order('created_at', { ascending: false });

  if (filters.cliente_id) q = q.eq('cliente_id', filters.cliente_id);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row: any) => ({
    ...row,
    image_count: row.ideia_files?.[0]?.count ?? 0,
  })) as unknown as Ideia[];
}

export async function updateIdeiaStatus(ideiaId: string, status: Ideia['status']): Promise<void> {
  const { error } = await supabase.from('ideias').update({ status }).eq('id', ideiaId);
  if (error) throw new Error(error.message);
}

export async function upsertIdeiaComentario(
  ideiaId: string,
  comentario: string,
  autorId: number,
): Promise<void> {
  const { error } = await supabase
    .from('ideias')
    .update({
      comentario_agencia: comentario,
      comentario_autor_id: autorId,
      comentario_at: new Date().toISOString(),
    })
    .eq('id', ideiaId);
  if (error) throw new Error(error.message);
}

export async function toggleIdeiaReaction(
  ideiaId: string,
  membroId: number,
  emoji: string,
): Promise<void> {
  // Check if this user already reacted with this emoji
  const { data: existing } = await supabase
    .from('ideia_reactions')
    .select('id')
    .eq('ideia_id', ideiaId)
    .eq('membro_id', membroId)
    .eq('emoji', emoji)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase.from('ideia_reactions').delete().eq('id', existing.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase
      .from('ideia_reactions')
      .insert({ ideia_id: ideiaId, membro_id: membroId, emoji });
    if (error) throw new Error(error.message);
  }
}
