import { useTranslation } from 'react-i18next';
import { ExternalLink, Instagram } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { sanitizeUrl } from '@/utils/security';
import type { InstagramCommentAutomation } from '../../store';

/** Same cap the dialog applies to a caption snapshot. Duplicated on purpose --
 * see the same helper in AutomationFormDialog.tsx and PostAutomationSection.tsx. */
function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * The "Alvo" cell: five branches, in precedence order, shared by the
 * Automações table (`AutomacoesPage`) and the Entregas drawer's per-post
 * shortcut (`PostAutomationSection`) -- moved here verbatim from
 * `AutomacoesPage` so the two surfaces can never drift on which state wins.
 *
 * 1. `pending_post_deleted_at` -- tombstoned: the target post was deleted
 *    before it ever published. Wins over everything else.
 * 2. `ig_media_id` -- already linked to a live Instagram post.
 * 3. `workflow_post_id` + `target_unlinked_at` -- the post was marked
 *    "postado" by hand, outside the publish flow, so `ig_media_id` will
 *    never arrive on its own; offers a re-mirror action when `canEdit`.
 * 4. `workflow_post_id` alone -- still awaiting publication through the app.
 * 5. Neither -- the automation listens to every post from the client.
 */
export function AutomationTargetCell({
  automation: a,
  canEdit,
  onRetarget,
}: {
  automation: InstagramCommentAutomation;
  /** `can('automacoes', 'editar') === true`, computed by the caller. Each
   * call site derives this differently -- `AutomacoesPage` has `useAuth()`
   * and a `can`; `PostAutomationSection` only has the `canManage` prop the
   * drawers already compute with that same expression. */
  canEdit: boolean;
  onRetarget: (automation: InstagramCommentAutomation) => void;
}) {
  const { t } = useTranslation('automations');

  if (a.pending_post_deleted_at) {
    return (
      <Badge variant="neutral" size="sm">
        {t('deletedPostBadge')}
      </Badge>
    );
  }

  if (a.ig_media_id) {
    return a.media_permalink ? (
      <a
        href={sanitizeUrl(a.media_permalink)}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1"
        style={{ color: 'var(--primary-color)' }}
      >
        <Instagram className="h-3.5 w-3.5" style={{ flexShrink: 0 }} />
        {a.media_caption ? truncate(a.media_caption, 40) : t('viewPost')}
        <ExternalLink className="h-3 w-3" style={{ flexShrink: 0 }} />
      </a>
    ) : (
      <span className="flex items-center gap-1">
        <Instagram className="h-3.5 w-3.5" style={{ flexShrink: 0 }} />
        {a.media_caption ? truncate(a.media_caption, 40) : t('viewPost')}
      </span>
    );
  }

  if (a.workflow_post_id) {
    return a.target_unlinked_at ? (
      <span className="flex flex-wrap items-center gap-1.5">
        {truncate(a.media_caption ?? '', 40)}
        <Badge variant="warning" size="sm" title={t('unlinkedTargetHint')}>
          {t('unlinkedTargetBadge')}
        </Badge>
        {canEdit && (
          <button
            type="button"
            className="text-xs underline"
            style={{ color: 'var(--primary-color)' }}
            onClick={() => onRetarget(a)}
          >
            {t('unlinkedTargetAction')}
          </button>
        )}
      </span>
    ) : (
      <span className="flex flex-wrap items-center gap-1.5">
        {truncate(a.media_caption ?? '', 40)}
        <Badge variant="info" size="sm">
          {t('pendingBadge')}
        </Badge>
      </span>
    );
  }

  return (
    <Badge variant="neutral" size="sm">
      {t('allPosts')}
    </Badge>
  );
}
