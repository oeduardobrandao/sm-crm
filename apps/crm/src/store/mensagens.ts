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

export interface MensagensCursor {
  before: string;
  beforeSource: MensagemFeedItem['source'];
  beforeItemId: number;
}

const FEED_PAGE_SIZE = 50;

export async function getMensagensFeed(params: {
  clienteId?: number;
  cursor?: MensagensCursor;
  limit?: number;
}): Promise<MensagemFeedItem[]> {
  const rpcParams: Record<string, unknown> = { p_limit: params.limit ?? FEED_PAGE_SIZE };
  if (params.clienteId != null) rpcParams.p_cliente_id = params.clienteId;
  if (params.cursor) {
    rpcParams.p_before = params.cursor.before;
    rpcParams.p_before_source = params.cursor.beforeSource;
    rpcParams.p_before_item_id = params.cursor.beforeItemId;
  }
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

export interface MensagemConversa {
  cliente_id: number;
  cliente_nome: string;
  last_source: MensagemFeedItem['source'];
  last_action: string | null;
  last_content: string | null;
  last_is_workspace_user: boolean;
  last_author_name: string | null;
  last_created_at: string;
  unread_count: number;
}

/** One row per cliente with the latest feed item + the caller's unread count
 * (the WhatsApp-style conversation list). */
export async function getMensagensConversas(): Promise<MensagemConversa[]> {
  const { data, error } = await supabase.rpc('get_mensagens_conversas', {});
  if (error) throw error;
  return (data ?? []) as MensagemConversa[];
}

export interface PostChipPreview {
  id: number;
  titulo: string;
  tipo: 'feed' | 'reels' | 'stories' | 'carrossel';
  status: string;
  scheduled_at: string | null;
  workflow_id: number;
  workflow_titulo: string | null;
}

/** Lightweight post details for the hover preview on linked-post chips. */
export async function getPostChipPreview(postId: number): Promise<PostChipPreview | null> {
  const { data, error } = await supabase
    .from('workflow_posts')
    .select('id, titulo, tipo, status, scheduled_at, workflow_id, workflows!inner(titulo)')
    .eq('id', postId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const wf = data.workflows as unknown as { titulo: string | null } | null;
  return {
    id: data.id,
    titulo: data.titulo,
    tipo: data.tipo,
    status: data.status,
    scheduled_at: data.scheduled_at ?? null,
    workflow_id: data.workflow_id,
    workflow_titulo: wf?.titulo ?? null,
  };
}
