import { useTranslation } from 'react-i18next';
import { useDateFnsLocale, useIntlLocale } from '@mesaas/i18n';
import { formatDistanceToNowStrict } from 'date-fns';
import type { Locale } from 'date-fns';
import type { Categoria, IgComment } from '../../../services/instagramComments';
import { CommentActions } from './CommentActions';
import { countText } from './CommentsAnalysisView';

function relative(ts: string, locale: Locale): string {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  return formatDistanceToNowStrict(d, { addSuffix: true, locale });
}

/** What a row needs to show the "⋯" menu; absent when the user can't moderate. */
export interface Moderation {
  compact: boolean;
  pending: ReadonlySet<string>;
  hide(c: IgComment, hidden: boolean): Promise<void>;
  remove(c: IgComment): Promise<void>;
}

export function CommentRow({
  c,
  reply = false,
  moderation,
  hideRepliesCount = false,
}: {
  c: IgComment;
  reply?: boolean;
  moderation: Moderation | null;
  /** Rendered in a later step; accepted now so the thread can already pass them. */
  tipo?: Categoria | null;
  inReplyTo?: string | null;
  /** The thread toggle already says how many replies there are. */
  hideRepliesCount?: boolean;
}) {
  const { t } = useTranslation('analyticsComments');
  const dfLocale = useDateFnsLocale();
  const locale = useIntlLocale();
  const name = (c.username || '').replace(/^@/, '');
  const initial = name.charAt(0).toUpperCase() || '?';
  const replies = hideRepliesCount
    ? null
    : c.replies_more || c.replies_count >= 25
      ? t('count.repliesMany')
      : c.replies_count > 0
        ? countText(t, 'reply', c.replies_count, locale)
        : null;
  const meta = [countText(t, 'like', c.like_count || 0, locale), replies]
    .filter(Boolean)
    .join(' · ');
  const when = relative(c.timestamp, dfLocale);
  const hidden = c.hidden === true;
  const className = ['igc-comment', reply && 'igc-comment--reply', hidden && 'igc-comment--hidden']
    .filter(Boolean)
    .join(' ');
  return (
    <li className={className}>
      <span className="igc-comment__avatar" aria-hidden="true">
        {initial}
      </span>
      <div className="igc-comment__body">
        <span className="igc-comment__head">
          <b>{name ? `@${name}` : t('post.unknownUser')}</b>
          {c.from_owner && <span className="igc-badge">{t('moderation.ownerBadge')}</span>}
          {hidden && <span className="igc-badge">{t('moderation.hiddenBadge')}</span>}
          {when && <span className="igc-comment__when">{` · ${when}`}</span>}
        </span>
        <span className="igc-comment__text">{c.text}</span>
        <span className="igc-comment__meta">{meta}</span>
      </div>
      {moderation && (
        <CommentActions
          comment={c}
          compact={moderation.compact}
          disabled={moderation.pending.has(c.id)}
          onHide={(next) => void moderation.hide(c, next)}
          onDelete={() => moderation.remove(c)}
        />
      )}
    </li>
  );
}
