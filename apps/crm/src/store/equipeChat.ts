import { supabase } from './core';

export interface EquipeConversa {
  conversa_id: number;
  tipo: 'grupo' | 'dm';
  nome: string | null;
  /** Grupo: nome do grupo; DM: nome do colega. */
  display_nome: string;
  /** DM: avatar do colega; grupo: NULL. */
  avatar_url: string | null;
  participantes_count: number;
  last_author_name: string | null;
  last_content: string | null;
  last_has_anexo: boolean;
  /** NULL quando a conversa ainda nao tem mensagens. */
  last_created_at: string | null;
  last_message_id: number | null;
  unread_count: number;
}

export interface EquipeMensagemAnexo {
  id: number;
  file_name: string;
  mime_type: string;
  size_bytes: number;
}

export interface EquipeMensagem {
  id: number;
  conversa_id: number;
  author_user_id: string;
  author_name: string;
  author_avatar_url: string | null;
  content: string;
  created_at: string;
  anexos: EquipeMensagemAnexo[];
}

export interface EquipeChatMember {
  user_id: string;
  nome: string;
  avatar_url: string | null;
  role: string;
}

export interface EquipeMensagensCursor {
  before: string;
  beforeId: number;
}

const PAGE_SIZE = 50;

export async function getEquipeConversas(): Promise<EquipeConversa[]> {
  const { data, error } = await supabase.rpc('get_equipe_conversas', {});
  if (error) throw error;
  return (data ?? []) as EquipeConversa[];
}

export async function getEquipeMensagens(params: {
  conversaId: number;
  cursor?: EquipeMensagensCursor;
  limit?: number;
}): Promise<EquipeMensagem[]> {
  const rpcParams: Record<string, unknown> = {
    p_conversa_id: params.conversaId,
    p_limit: params.limit ?? PAGE_SIZE,
  };
  if (params.cursor) {
    rpcParams.p_before = params.cursor.before;
    rpcParams.p_before_id = params.cursor.beforeId;
  }
  const { data, error } = await supabase.rpc('get_equipe_mensagens', rpcParams);
  if (error) throw error;
  return (data ?? []) as EquipeMensagem[];
}

export async function createEquipeConversa(
  tipo: 'grupo' | 'dm',
  nome: string | null,
  userIds: string[],
): Promise<number> {
  const { data, error } = await supabase.rpc('create_equipe_conversa', {
    p_tipo: tipo,
    p_nome: nome,
    p_user_ids: userIds,
  });
  if (error) throw error;
  return data as number;
}

export type EquipeConversaAction = 'rename' | 'add' | 'remove' | 'leave';

export async function manageEquipeConversa(
  conversaId: number,
  action: EquipeConversaAction,
  opts: { nome?: string; userId?: string } = {},
): Promise<void> {
  const { error } = await supabase.rpc('manage_equipe_conversa', {
    p_conversa_id: conversaId,
    p_action: action,
    p_nome: opts.nome ?? null,
    p_user_id: opts.userId ?? null,
  });
  if (error) throw error;
}

export async function markEquipeConversaSeen(
  conversaId: number,
  lastMessageId: number,
): Promise<void> {
  const { error } = await supabase.rpc('mark_equipe_conversa_seen', {
    p_conversa_id: conversaId,
    p_last_message_id: lastMessageId,
  });
  if (error) throw error;
}

export async function getEquipeChatUnread(): Promise<number> {
  const { data, error } = await supabase.rpc('get_equipe_chat_unread', {});
  if (error) throw error;
  return (data ?? 0) as number;
}

export async function getEquipeChatMembers(): Promise<EquipeChatMember[]> {
  const { data, error } = await supabase.rpc('get_equipe_chat_members', {});
  if (error) throw error;
  return (data ?? []) as EquipeChatMember[];
}

/** IDs dos participantes de uma conversa. Select direto (RLS cobre — a
 * própria tabela só é legível pra quem participa da conversa), não RPC. */
export async function getEquipeConversaParticipantes(conversaId: number): Promise<string[]> {
  const { data, error } = await supabase
    .from('equipe_conversa_participantes')
    .select('user_id')
    .eq('conversa_id', conversaId);
  if (error) throw error;
  return (data ?? []).map((row) => (row as { user_id: string }).user_id);
}

export async function sendEquipeMensagem(
  conversaId: number,
  content: string,
  anexoIds?: number[],
): Promise<number> {
  const { data, error } = await supabase.rpc('send_equipe_mensagem', {
    p_conversa_id: conversaId,
    p_content: content,
    p_anexo_ids: anexoIds && anexoIds.length > 0 ? anexoIds : null,
  });
  if (error) throw error;
  return data as number;
}
