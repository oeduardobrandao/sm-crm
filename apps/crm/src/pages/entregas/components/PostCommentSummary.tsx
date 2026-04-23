import { useState } from 'react';
import { MessageSquare, ChevronDown, ChevronRight } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { CommentThreadWithComments, Membro } from '@/store';

interface PostCommentSummaryProps {
  threads: CommentThreadWithComments[];
  membros: Membro[];
  onThreadClick: (threadId: number) => void;
  readOnly?: boolean;
}

function resolveAuthorName(userId: string, membros: Membro[]): string {
  return membros.find((m) => m.user_id === userId)?.nome ?? 'Membro';
}

export default function PostCommentSummary({
  threads,
  membros,
  onThreadClick,
}: PostCommentSummaryProps) {
  const activeThreads = threads.filter((t) => t.status === 'active');
  const resolvedThreads = threads.filter((t) => t.status === 'resolved');

  const [expanded, setExpanded] = useState(activeThreads.length > 0);
  const [showResolved, setShowResolved] = useState(false);

  if (threads.length === 0) return null;

  const visibleThreads = showResolved
    ? [...activeThreads, ...resolvedThreads]
    : activeThreads;

  return (
    <div className="comment-summary">
      <div
        className="comment-summary-header"
        onClick={() => setExpanded((prev) => !prev)}
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        <MessageSquare className="h-3.5 w-3.5" />
        <span className="comment-summary-title">Comentários internos</span>
        <span className="comment-summary-count">({threads.length})</span>

        {resolvedThreads.length > 0 && (
          <button
            className="comment-summary-toggle"
            onClick={(e) => {
              e.stopPropagation();
              setShowResolved((prev) => !prev);
            }}
          >
            {showResolved ? 'Ocultar resolvidos' : 'Mostrar resolvidos'}
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
                    isResolved
                      ? 'comment-summary-dot--resolved'
                      : 'comment-summary-dot--active'
                  }`}
                />
                <div className="comment-summary-content">
                  {thread.quoted_text && (
                    <span className="comment-summary-quote">
                      {thread.quoted_text}
                    </span>
                  )}
                  {firstComment && (
                    <span className="comment-summary-preview">
                      {firstComment.content}
                    </span>
                  )}
                  <div className="comment-summary-meta">
                    <span className="comment-summary-author">
                      {resolveAuthorName(thread.created_by, membros)}
                    </span>
                    <span className="comment-summary-date">
                      {formatDistanceToNow(new Date(thread.created_at), {
                        locale: ptBR,
                        addSuffix: true,
                      })}
                    </span>
                  </div>
                  {replyCount > 0 && (
                    <span className="comment-summary-replies">
                      {replyCount === 1 ? '1 resposta' : `${replyCount} respostas`}
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
