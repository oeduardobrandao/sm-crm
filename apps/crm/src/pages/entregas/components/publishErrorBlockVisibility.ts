import type { WorkflowPost } from '../../../store';

// PublishErrorBlock é específico do lado Instagram (copy, código de erro e retry
// são todos do Instagram). Para platform='both' com Instagram já publicado
// (instagram_media_id preenchido), a falha só pode ser do TikTok — montar o bloco
// nesse caso rende copy UNKNOWN e um "Tentar novamente" que reagenda o Instagram
// (já publicado) sem tocar o lado TikTok, encalhando o post.
export function shouldShowPublishErrorBlock(
  post: Pick<WorkflowPost, 'status' | 'platform' | 'instagram_media_id'>,
): boolean {
  return (
    post.status === 'falha_publicacao' && post.platform !== 'tiktok' && !post.instagram_media_id
  );
}
