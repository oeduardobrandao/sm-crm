import { MessageSquareWarning } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { MediaNote } from '@/store/mediaNotes';
import type { PostApproval } from '@/store/posts';

/**
 * "Aprovado com N comentários em aberto": the client approved while notes were still open.
 * Shown only when the latest client `aprovado` carries a non-empty snapshot, and N is the
 * LIVE count of open client notes (so it disappears once the team resolves them all).
 */
export function OpenNotesBadge({
  approvals,
  notes,
}: {
  approvals: PostApproval[];
  notes: MediaNote[];
}) {
  const latest = approvals
    .filter((a) => a.action === 'aprovado' && !a.is_workspace_user)
    .reduce<PostApproval | null>((acc, a) => {
      if (!acc) return a;
      const diff = Date.parse(a.created_at) - Date.parse(acc.created_at);
      return diff > 0 || (diff === 0 && a.id > acc.id) ? a : acc;
    }, null);
  if (!latest || (latest.media_note_ids ?? []).length === 0) return null;

  const open = notes.filter((n) => n.visibility === 'client' && n.status === 'open').length;
  if (open === 0) return null;

  const label =
    open === 1
      ? 'Aprovado com 1 comentário em aberto'
      : `Aprovado com ${open} comentários em aberto`;
  return (
    <Badge variant="warning" size="sm" className="open-notes-badge">
      <MessageSquareWarning className="h-3 w-3" aria-hidden="true" />
      {label}
    </Badge>
  );
}
