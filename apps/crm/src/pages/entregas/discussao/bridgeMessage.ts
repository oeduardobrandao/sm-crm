import { i18n } from '@mesaas/i18n';
import { formatMentionToken } from '@/components/mentions/mentionTokens';

export interface BridgePost {
  id: number;
  titulo: string;
  /** Parent workflow; null for a standalone (avulso) post. */
  workflowId: number | null;
}

/** Max length of a team-chat message after trim. */
export const BRIDGE_MESSAGE_MAX = 4000;

/** The post as a plain-text mention token: `@[titulo](post:id:workflowId)`, without
 * the `:workflowId` segment for a standalone post. */
export function bridgePostToken(post: BridgePost): string {
  return formatMentionToken({
    entityType: 'post',
    id: post.id,
    label: post.titulo.trim() || i18n.t('postPanels:discutirNoChat.untitled'),
    ...(post.workflowId != null ? { parentId: post.workflowId } : {}),
  });
}

/** Content of the chat message that carries the post: the optional text, then the
 * post token on its own line (no leading newline when the text is empty). */
export function buildBridgeMessage(text: string, post: BridgePost): string {
  const token = bridgePostToken(post);
  const body = text.trim();
  return body ? `${body}\n${token}` : token;
}
