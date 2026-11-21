import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '@mesaas/i18n';
import type { Categoria, IgComment } from '../../../services/instagramComments';
import { sanitizeUrl } from '../../../utils/security';
import { CommentRow, type Moderation } from './CommentRow';
import type { CommentGroup } from './groupComments';

/** A top-level comment and, behind "Ver N respostas", the replies the list holds. */
export function CommentThread({
  group,
  open,
  onToggle,
  moderation,
  permalink,
  tipoFor,
}: {
  group: CommentGroup;
  open: boolean;
  onToggle(): void;
  moderation: Moderation | null;
  permalink: string;
  tipoFor?(c: IgComment): Categoria | null;
}) {
  const { t } = useTranslation('analyticsComments');
  const locale = useIntlLocale();
  const repliesId = useId();
  const { comment, replies } = group;
  const hasReplies = replies.length > 0;
  const missing = comment.replies_count - replies.length;
  const moreOnInstagram = comment.replies_more
    ? t('threads.moreOnInstagramMany')
    : missing > 0
      ? t('threads.moreOnInstagram', { count: missing, n: missing.toLocaleString(locale) })
      : null;
  return (
    <>
      <CommentRow
        c={comment}
        moderation={moderation}
        tipo={tipoFor?.(comment)}
        hideRepliesCount={hasReplies}
      />
      {hasReplies && (
        <li className="igc-thread">
          <button
            type="button"
            className="igc-thread__toggle"
            aria-expanded={open}
            aria-controls={open ? repliesId : undefined}
            onClick={onToggle}
          >
            {open
              ? t('threads.hide')
              : t('threads.view', {
                  count: replies.length,
                  n: replies.length.toLocaleString(locale),
                })}
          </button>
          {open && (
            <ul id={repliesId} className="igc-thread__replies">
              {replies.map((r) => (
                <CommentRow
                  key={r.id}
                  c={r}
                  reply
                  moderation={moderation}
                  tipo={tipoFor?.(r)}
                  inReplyTo={comment.id}
                />
              ))}
              {moreOnInstagram && (
                <li className="igc-thread__more">
                  <a href={sanitizeUrl(permalink)} target="_blank" rel="noopener noreferrer">
                    {moreOnInstagram}
                  </a>
                </li>
              )}
            </ul>
          )}
        </li>
      )}
    </>
  );
}
