import { format } from 'date-fns';
import type { TFunction } from 'i18next';
import type { InstagramAutomationSend, InstagramCommentAutomation } from '../../../store';

/** Pill colours of the phone rows and sheets (classes `phone-auto-pill--<tone>`). */
export type PillTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export const SEND_STATUS_TONE: Record<InstagramAutomationSend['status'], PillTone> = {
  sent: 'success',
  sent_partial: 'warning',
  failed: 'danger',
  skipped: 'neutral',
  retry: 'info',
  processing: 'info',
};

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** "09/10/2026": the compact date of the phone rows (FAutomacoes mockup). */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : format(d, 'dd/MM/yyyy');
}

export interface TargetSummary {
  /** What the automation listens to, for the row subtitle; null when only the badge says it. */
  text: string | null;
  /** State the desktop shows as a badge next to the target. */
  badge: { label: string; tone: PillTone } | null;
  /** The target post was published outside the app (re-target offered). */
  unlinked: boolean;
  /** The target post was deleted before publishing (tombstone). */
  deleted: boolean;
}

/**
 * The same five branches, in the same precedence order, as `AutomationTargetCell`
 * (tombstone, linked live post, unlinked, pending, all posts), as plain data for the
 * phone row and detail sheet.
 */
export function targetSummary(a: InstagramCommentAutomation, t: TFunction): TargetSummary {
  if (a.pending_post_deleted_at) {
    return {
      text: null,
      badge: { label: t('deletedPostBadge'), tone: 'danger' },
      unlinked: false,
      deleted: true,
    };
  }
  if (a.ig_media_id) {
    return {
      text: a.media_caption ? truncate(a.media_caption, 40) : t('viewPost'),
      badge: null,
      unlinked: false,
      deleted: false,
    };
  }
  if (a.workflow_post_id) {
    const caption = a.media_caption ? `“${truncate(a.media_caption, 40)}”` : null;
    return a.target_unlinked_at
      ? {
          text: caption,
          badge: { label: t('unlinkedTargetBadge'), tone: 'warning' },
          unlinked: true,
          deleted: false,
        }
      : {
          text: caption,
          badge: { label: t('pendingBadge'), tone: 'warning' },
          unlinked: false,
          deleted: false,
        };
  }
  return { text: t('allPosts'), badge: null, unlinked: false, deleted: false };
}
