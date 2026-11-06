import { useState } from 'react';
import { MessageSquare, ChevronDown, ChevronRight } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useTranslation } from 'react-i18next';
import { i18n, useDateFnsLocale } from '@mesaas/i18n';
import type { CommentThreadWithComments, Membro } from '@/store';
import { isGeralThread } from '@/store/comments';

interface WorkspaceUser {
  id: string;
  nome: string;
  avatar_url: string | null;
}

interface PostCommentSummaryProps {
  threads: CommentThreadWithComments[];
  membros: Membro[];
  workspaceUsers?: WorkspaceUser[];
  onThreadClick: (threadId: number) => void;
  readOnly?: boolean;
}

export function resolveAuthorName(
  userId: string,
  membros: Membro[],
  workspaceUsers: WorkspaceUser[],
): string {
  const wsUser = workspaceUsers.find((u) => u.id === userId);
  if (wsUser) return wsUser.nome;
  return (
    membros.find((m) => m.crm_user_id === userId)?.nome ??
    i18n.t('postPanels:discussao.memberFallback')
  );
}

export default function PostCommentSummary({
  threads: allThreads,
  membros,
  workspaceUsers = [],
  onThreadClick,
}: PostCommentSummaryProps) {
  // The general discussion thread has no passage: it is shown by the discussion section.
  const { t } = useTranslation('postPanels');
  const dateLocale = useDateFnsLocale();
  const threads = allThreads.filter((th) => !isGeralThread(th));
  const activeThreads = threads.filter((th) => th.status === 'active');
  const resolvedThreads = threads.filter((th) => th.status === 'resolved');

  const [expanded, setExpanded] = useState(activeThreads.length > 0);
  const [showResolved, setShowResolved] = useState(false);

  if (threads.length === 0) return null;

  const visibleThreads = showResolved ? [...activeThreads, ...resolvedThreads] : activeThreads;

  return (
    <div className="comment-summary">
      <div className="comment-summary-header" onClick={() => setExpanded((prev) => !prev)}>
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        <MessageSquare className="h-3.5 w-3.5" />
        <span className="comment-summary-title">{t('commentSummary.title')}</span>
        <span className="comment-summary-count">({threads.length})</span>

        {resolvedThreads.length > 0 && (
          <button
            className="comment-summary-toggle"
            onClick={(e) => {
              e.stopPropagation();
              setShowResolved((prev) => !prev);
            }}
          >
            {showResolved ? t('commentSummary.hideResolved') : t('commentSummary.showResolved')}
          </button>
        )}
      </div>

      {expanded && (
        <div className="comment-summary-list">
          {visibleThreads.map((thread) => {
            const isResolved = thread.status === 'resolved';
            const firstComment = thread.post_comments[0];
            const replyCount = thread.post_comments.length - 1;

            return (
              <div
                key={thread.id}
                className="comment-summary-item"
                onClick={() => onThreadClick(thread.id)}
              >
                <div
                  className={`comment-summary-dot ${
                    isResolved ? 'comment-summary-dot--resolved' : 'comment-summary-dot--active'
                  }`}
                />
                <div className="comment-summary-content">
                  {thread.field === 'ig_caption' && (
                    <span className="comment-summary-badges">
                      <span className="comment-summary-chip">
                        {t('commentSummary.captionChip')}
                      </span>
                      {thread.orphaned && (
                        <span className="comment-summary-chip comment-summary-chip--muted">
                          {t('discussao.textRemoved')}
                        </span>
                      )}
                    </span>
                  )}
                  {thread.quoted_text && (
                    <span className="comment-summary-quote">{thread.quoted_text}</span>
                  )}
                  {firstComment && (
                    <span className="comment-summary-preview">{firstComment.content}</span>
                  )}
                  <div className="comment-summary-meta">
                    <span className="comment-summary-author">
                      {resolveAuthorName(thread.created_by, membros, workspaceUsers)}
                    </span>
                    <span className="comment-summary-date">
                      {formatDistanceToNow(new Date(thread.created_at), {
                        locale: dateLocale,
                        addSuffix: true,
                      })}
                    </span>
                  </div>
                  {replyCount > 0 && (
                    <span className="comment-summary-replies">
                      {t('discussao.replyCount', { count: replyCount })}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
