import { supabase, getContaId, getUserId } from './core';

export interface MensagemFeedItem {
  source: 'post_feedback' | 'edit_suggestion' | 'mensagem';
  item_id: number;
  cliente_id: number;
  cliente_nome: string;
  post_id: number | null;
  workflow_id: number | null;
  post_titulo: string | null;
  action: string | null;
  content: string | null;
  is_workspace_user: boolean;
  author_user_id: string | null;
  author_name: string | null;
  author_avatar_url: string | null;
  created_at: string;
}

export interface MensagensUnreadRow {
  cliente_id: number;
  unread_count: number;
}

const FEED_PAGE_SIZE = 50;

export async function getMensagensFeed(params: {
  clienteId?: number;
  before?: string;
  limit?: number;
}): Promise<MensagemFeedItem[]> {
  const rpcParams: Record<string, unknown> = { p_limit: params.limit ?? FEED_PAGE_SIZE };
  if (params.clienteId != null) rpcParams.p_cliente_id = params.clienteId;
  if (params.before) rpcParams.p_before = params.before;
  const { data, error } = await supabase.rpc('get_mensagens_feed', rpcParams);
  if (error) throw error;
  return (data ?? []) as MensagemFeedItem[];
}

export async function getMensagensUnread(): Promise<MensagensUnreadRow[]> {
  const { data, error } = await supabase.rpc('get_mensagens_unread', {});
  if (error) throw error;
  return (data ?? []) as MensagensUnreadRow[];
}

export async function sendMensagem(clienteId: number, content: string): Promise<void> {
  const conta_id = await getContaId();
  const author_user_id = await getUserId();
  const { error } = await supabase.from('mensagens').insert({
    conta_id,
    cliente_id: clienteId,
    content,
    is_workspace_user: true,
    author_user_id,
  });
  if (error) throw error;
}

export async function markMensagensSeen(): Promise<void> {
  const { error } = await supabase.rpc('mark_mensagens_seen', {});
  if (error) throw error;
}
