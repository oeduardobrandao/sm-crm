import { PLATFORM_IDS, type PlatformId } from '@mesaas/platforms';
import { supabase } from './core';

/**
 * Destinos de um post (tabela post_targets, migration 20261010100002).
 * Spec: docs/superpowers/specs/2026-09-29-platform-agnostic-posts-design.md
 *
 * Onde mora a legenda de cada destino (P2):
 *   instagram -> workflow_posts.ig_caption (save_ig_caption: âncoras, versões, sugestões)
 *   tiktok    -> workflow_posts.tiktok_caption (o publicador do TikTok lê essa coluna até P4)
 *   geral     -> post_targets.caption
 * O banco deriva workflow_posts.platform sozinho a cada INSERT/DELETE aqui
 * (trigger post_targets_sync_platform); nada deste módulo escreve platform.
 */
export type PostTargetStatus =
  | 'pendente'
  | 'agendado'
  | 'processando'
  | 'publicado'
  | 'falha'
  | 'disponivel';

export interface PostTargetSummary {
  platform: PlatformId;
  status: PostTargetStatus;
}

export interface PostTargetRow extends PostTargetSummary {
  id: number;
  post_id: number;
  caption: string | null;
}

export function sortByPlatformOrder<T extends { platform: PlatformId }>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) => PLATFORM_IDS.indexOf(a.platform) - PLATFORM_IDS.indexOf(b.platform),
  );
}

export async function getPostTargets(postId: number): Promise<PostTargetRow[]> {
  const { data, error } = await supabase
    .from('post_targets')
    .select('id, post_id, platform, status, caption')
    .eq('post_id', postId);
  if (error) throw error;
  return sortByPlatformOrder((data ?? []) as PostTargetRow[]);
}

/** Espelha post_board_platforms() do banco: fluxo, ou o padrão do cliente se avulso. */
export async function getBoardPlatforms(post: {
  workflow_id: number | null;
  cliente_id: number;
}): Promise<PlatformId[]> {
  if (post.workflow_id != null) {
    const { data, error } = await supabase
      .from('workflows')
      .select('plataformas')
      .eq('id', post.workflow_id)
      .maybeSingle();
    if (error) throw error;
    return ((data as { plataformas?: PlatformId[] } | null)?.plataformas ?? [
      'instagram',
    ]) as PlatformId[];
  }
  const { data, error } = await supabase
    .from('clientes')
    .select('plataformas_padrao')
    .eq('id', post.cliente_id)
    .maybeSingle();
  if (error) throw error;
  return ((data as { plataformas_padrao?: PlatformId[] } | null)?.plataformas_padrao ?? [
    'instagram',
  ]) as PlatformId[];
}

/**
 * Liga um destino. `seedCaption` (já cortada no limite da plataforma) só vem quando
 * a legenda própria do destino está vazia (quem decide é seedCaptionFor). Geral leva
 * a legenda no próprio INSERT; Instagram/TikTok gravam a legenda depois, nas colunas
 * legadas (desvio 5 do plano P2: dois requests, sem transação).
 */
export async function addPostDestination(args: {
  postId: number;
  contaId: string;
  platform: PlatformId;
  seedCaption: string | null;
}): Promise<void> {
  const { postId, contaId, platform, seedCaption } = args;
  const row: Record<string, unknown> = { conta_id: contaId, post_id: postId, platform };
  if (platform === 'geral') row.caption = seedCaption;
  const { error } = await supabase.from('post_targets').insert(row);
  // 23505 = o destino já existe (clique duplo, outra aba): nada a fazer.
  if (error && (error as { code?: string }).code !== '23505') throw error;
  if (error || !seedCaption || platform === 'geral') return;

  if (platform === 'instagram') {
    const { error: capErr } = await supabase.rpc('save_ig_caption', {
      p_post_id: postId,
      p_caption: seedCaption,
      p_anchors: [],
    });
    if (capErr) throw capErr;
    return;
  }
  const { error: capErr } = await supabase
    .from('workflow_posts')
    .update({ tiktok_caption: seedCaption })
    .eq('id', postId);
  if (capErr) throw capErr;
}

export async function removePostDestination(postId: number, platform: PlatformId): Promise<void> {
  const { error } = await supabase
    .from('post_targets')
    .delete()
    .eq('post_id', postId)
    .eq('platform', platform);
  if (error) {
    // Guarda de DELETE (P4): destino publicando ou publicado não sai enquanto o post existe.
    if ((error as { code?: string }).code === 'P0409') throw new TargetNotRemovableError();
    throw error;
  }
}

/** O destino publicando ou publicado não pode ser removido (P0409 target_not_removable, migration P4). */
export class TargetNotRemovableError extends Error {
  constructor() {
    super('Destino publicando ou publicado não pode ser removido.');
    this.name = 'TargetNotRemovableError';
  }
}

/** O destino Geral não existe mais (tirado em Destinos enquanto um rascunho esperava o debounce). */
export class DestinationGoneError extends Error {
  constructor() {
    super('Nenhuma linha atualizada (post_targets).');
    this.name = 'DestinationGoneError';
  }
}

/** Legenda de TikTok ou Geral. A do Instagram segue em save_ig_caption (comments.ts). */
export async function savePostCaption(
  postId: number,
  platform: 'tiktok' | 'geral',
  text: string,
): Promise<void> {
  // .select('id'): um UPDATE que casa 0 linhas (destino Geral já removido, RLS negando)
  // não dá erro no PostgREST. Sem a linha de volta o rascunho ficaria "salvo" só na
  // aparência e preso como trabalho não salvo para sempre.
  if (platform === 'tiktok') {
    const { data, error } = await supabase
      .from('workflow_posts')
      .update({ tiktok_caption: text })
      .eq('id', postId)
      .select('id');
    if (error) throw error;
    if (!data || data.length === 0) throw new Error('Nenhuma linha atualizada (workflow_posts).');
    return;
  }
  const { data, error } = await supabase
    .from('post_targets')
    // Sem updated_at: post_targets não tem trigger de updated_at e o relógio do
    // cliente não deve ir para o banco. A coluna fica com a hora da criação.
    .update({ caption: text })
    .eq('post_id', postId)
    .eq('platform', 'geral')
    .select('id');
  if (error) throw error;
  if (!data || data.length === 0) throw new DestinationGoneError();
}
