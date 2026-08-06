import type { WorkflowPost } from '../../../store';

// PublishErrorBlock é específico do lado Instagram (copy, código de erro e retry
// são todos do Instagram). Para platform='both' com Instagram já publicado
// (instagram_media_id preenchido), a falha só pode ser do TikTok — montar o bloco
// nesse caso rende copy UNKNOWN e um "Tentar novamente" que reagenda o Instagram
// (já publicado) sem tocar o lado TikTok, encalhando o post.
//
// Em platform='both' o TikTok pode falhar primeiro (status vai para
// falha_publicacao com instagram_media_id ainda null porque o IG nem tentou).
// Nesse caso publish_error e publish_error_code também ficam null — só o lado
// Instagram grava esses campos via markFailed. Exigir um dos dois evita mostrar
// o bloco (com copy UNKNOWN e retry que reagenda o IG) para uma falha que é do
// TikTok.
export function shouldShowPublishErrorBlock(
  post: Pick<
    WorkflowPost,
    'status' | 'platform' | 'instagram_media_id' | 'publish_error' | 'publish_error_code'
  >,
): boolean {
  return (
    post.status === 'falha_publicacao' &&
    post.platform !== 'tiktok' &&
    !post.instagram_media_id &&
    !!(post.publish_error || post.publish_error_code)
  );
}
