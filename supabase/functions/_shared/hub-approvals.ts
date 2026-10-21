/**
 * Which post_approvals rows may leave the server towards the client Hub.
 * Team-authored messages (action = 'mensagem' AND is_workspace_user = true,
 * written by the CRM's replyToPostApproval for internal coordination; its
 * notification trigger only tells owner/admin) are internal and must never
 * reach a hub token holder, in any payload. aprovado/correcao rows and
 * client messages (is_workspace_user = false) are always visible. Used by
 * hub-posts (list payload) and hub-post-history (per-post history).
 */
export function isClientVisibleApproval(row: { action: string; is_workspace_user: boolean | null }): boolean {
  return !(row.action === "mensagem" && row.is_workspace_user === true);
}
