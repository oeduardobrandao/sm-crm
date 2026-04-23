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

function resolveMembro(authorId: string, membros: Membro[]): Membro | undefined {
  return membros.find((m) => m.user_id === authorId);
}

function AuthorAvatar({ membro }: { membro: Membro | undefined }) {
  const name = membro?.nome ?? 'Membro';
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

  if (membro?.avatar_url) {
    return (
      <img
        src={membro.avatar_url}
        alt={name}
        className="comment-avatar"
      />
    );
  }

  return <span className="comment-avatar comment-avatar--initials">{initials}</span>;
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
  const membro = resolveMembro(comment.author_id, membros);

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
        <AuthorAvatar membro={membro} />
        <div className="comment-item-header-text">
          <span className="comment-item-author">{membro?.nome ?? 'Membro'}</span>
          <span className="comment-item-date">{formatCommentDate(comment.created_at)}</span>
        </div>
        {!readOnly && !editing && (isAuthor || canDelete) && (
          <div className="comment-item-actions">
            {isAuthor && (
              <button
                className="comment-item-action"
                title="Editar"
                onClick={() => {
                  setEditContent(comment.content);
                  setEditing(true);
                }}
              >
                <Pencil size={12} />
              </button>
            )}
            {canDelete && (
              <button
                className="comment-item-action comment-item-action--danger"
                title="Excluir"
                onClick={() => onDelete(comment.id)}
              >
                <Trash2 size={12} />
              </button>
            )}
          </div>
        )}
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
        <div className="comment-item-body">
          <p className="comment-item-content">{comment.content}</p>
          {comment.updated_at && (
            <span className="comment-item-edited">(editado)</span>
          )}
        </div>
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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

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
              <Check size={14} />
            </button>
          )}
          {!readOnly && thread.status === 'resolved' && (
            <button
              className="comment-popover-action-btn"
              title="Reabrir"
              onClick={handleReopen}
              disabled={submitting}
            >
              <RotateCcw size={14} />
            </button>
          )}
          <button
            className="comment-popover-action-btn"
            title="Fechar"
            onClick={onClose}
          >
            <X size={14} />
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
            rows={1}
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
