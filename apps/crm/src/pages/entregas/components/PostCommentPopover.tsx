import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Check, RotateCcw, Pencil, Trash2 } from 'lucide-react';
import type { CommentThreadWithComments, PostComment, Membro } from '@/store';

interface PostCommentPopoverProps {
  thread: CommentThreadWithComments;
  membros: Membro[];
  currentUserId: string;
  currentUserRole: 'owner' | 'admin' | 'agent';
  onReply: (threadId: number, content: string) => Promise<void>;
  onResolve: (threadId: number) => Promise<void>;
  onReopen: (threadId: number) => Promise<void>;
  onEditComment: (commentId: number, content: string) => Promise<void>;
  onDeleteComment: (commentId: number, threadId: number) => Promise<void>;
  onClose: () => void;
  readOnly?: boolean;
}

function formatCommentDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function resolveAuthorName(authorId: string, membros: Membro[]): string {
  return membros.find((m) => m.user_id === authorId)?.nome ?? 'Membro';
}

function CommentItem({
  comment,
  membros,
  currentUserId,
  currentUserRole,
  readOnly,
  onEdit,
  onDelete,
}: {
  comment: PostComment;
  membros: Membro[];
  currentUserId: string;
  currentUserRole: 'owner' | 'admin' | 'agent';
  readOnly?: boolean;
  onEdit: (commentId: number, content: string) => Promise<void>;
  onDelete: (commentId: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(comment.content);
  const [saving, setSaving] = useState(false);
  const editRef = useRef<HTMLTextAreaElement>(null);

  const isAuthor = comment.author_id === currentUserId;
  const canDelete = isAuthor || currentUserRole === 'owner' || currentUserRole === 'admin';

  useEffect(() => {
    if (editing && editRef.current) {
      editRef.current.focus();
      editRef.current.selectionStart = editRef.current.value.length;
    }
  }, [editing]);

  const handleSaveEdit = async () => {
    const trimmed = editContent.trim();
    if (!trimmed || trimmed === comment.content) {
      setEditing(false);
      setEditContent(comment.content);
      return;
    }
    setSaving(true);
    try {
      await onEdit(comment.id, trimmed);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setEditing(false);
    setEditContent(comment.content);
  };

  return (
    <div className="comment-item">
      <div className="comment-item-header">
        <span className="comment-item-author">
          {resolveAuthorName(comment.author_id, membros)}
        </span>
        <span className="comment-item-date">
          {formatCommentDate(comment.created_at)}
        </span>
      </div>

      {editing ? (
        <>
          <textarea
            ref={editRef}
            className="comment-edit-input"
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            disabled={saving}
          />
          <div className="comment-edit-actions">
            <button
              className="comment-edit-save"
              onClick={handleSaveEdit}
              disabled={saving || !editContent.trim()}
            >
              Salvar
            </button>
            <button
              className="comment-edit-cancel"
              onClick={handleCancelEdit}
              disabled={saving}
            >
              Cancelar
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="comment-item-content">{comment.content}</p>
          {comment.updated_at && (
            <span className="comment-item-edited">(editado)</span>
          )}
          {!readOnly && (isAuthor || canDelete) && (
            <div className="comment-item-actions">
              {isAuthor && (
                <button
                  className="comment-item-action"
                  onClick={() => {
                    setEditContent(comment.content);
                    setEditing(true);
                  }}
                >
                  <Pencil size={12} />
                  Editar
                </button>
              )}
              {canDelete && (
                <button
                  className="comment-item-action comment-item-action--danger"
                  onClick={() => onDelete(comment.id)}
                >
                  <Trash2 size={12} />
                  Excluir
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function PostCommentPopover({
  thread,
  membros,
  currentUserId,
  currentUserRole,
  onReply,
  onResolve,
  onReopen,
  onEditComment,
  onDeleteComment,
  onClose,
  readOnly,
}: PostCommentPopoverProps) {
  const [replyContent, setReplyContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Scroll to bottom when comments change
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [thread.post_comments.length]);

  const handleReply = useCallback(async () => {
    const trimmed = replyContent.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await onReply(thread.id, trimmed);
      setReplyContent('');
    } finally {
      setSubmitting(false);
    }
  }, [replyContent, submitting, onReply, thread.id]);

  const handleReplyKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleReply();
    }
  };

  const handleResolve = async () => {
    setSubmitting(true);
    try {
      await onResolve(thread.id);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReopen = async () => {
    setSubmitting(true);
    try {
      await onReopen(thread.id);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = (commentId: number) => {
    if (window.confirm('Excluir este comentário?')) {
      onDeleteComment(commentId, thread.id);
    }
  };

  return (
    <div className="comment-popover">
      <div className="comment-popover-header">
        <span className="comment-popover-quoted">{thread.quoted_text}</span>
        <div className="comment-popover-actions">
          {!readOnly && thread.status === 'active' && (
            <button
              className="comment-popover-action-btn"
              title="Resolver"
              onClick={handleResolve}
              disabled={submitting}
            >
              <Check size={16} />
            </button>
          )}
          {!readOnly && thread.status === 'resolved' && (
            <button
              className="comment-popover-action-btn"
              title="Reabrir"
              onClick={handleReopen}
              disabled={submitting}
            >
              <RotateCcw size={16} />
            </button>
          )}
          <button
            className="comment-popover-action-btn"
            title="Fechar"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="comment-popover-body" ref={bodyRef}>
        {thread.post_comments.map((comment) => (
          <CommentItem
            key={comment.id}
            comment={comment}
            membros={membros}
            currentUserId={currentUserId}
            currentUserRole={currentUserRole}
            readOnly={readOnly}
            onEdit={onEditComment}
            onDelete={handleDelete}
          />
        ))}
      </div>

      {!readOnly && (
        <div className="comment-popover-footer">
          <textarea
            className="comment-reply-input"
            placeholder="Responder..."
            value={replyContent}
            onChange={(e) => setReplyContent(e.target.value)}
            onKeyDown={handleReplyKeyDown}
            disabled={submitting}
          />
          <button
            className="comment-reply-submit"
            onClick={handleReply}
            disabled={submitting || !replyContent.trim()}
          >
            Enviar
          </button>
        </div>
      )}
    </div>
  );
}
