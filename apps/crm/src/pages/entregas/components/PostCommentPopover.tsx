import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Check, RotateCcw, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { getIntlLocale } from '@mesaas/i18n';
import type { CommentThreadWithComments, PostComment, Membro } from '@/store';
// By path, not through the store barrel: the drawer test harnesses mock '@/store'.
import { DISCUSSAO_MAX_CHARS } from '@/store/comments';
import { PessoaAvatar } from '@/components/PessoaAvatar';
import { MentionText } from '@/components/mentions/MentionText';
import { MentionEditor } from '@/components/mentions/MentionEditor';
import { useAuth } from '@/context/AuthContext';

interface WorkspaceUser {
  id: string;
  nome: string;
  avatar_url: string | null;
}

interface PostCommentPopoverProps {
  thread: CommentThreadWithComments;
  membros: Membro[];
  workspaceUsers?: WorkspaceUser[];
  currentUserId: string;
  onReply: (threadId: number, content: string) => Promise<void>;
  onResolve: (threadId: number) => Promise<void>;
  onReopen: (threadId: number) => Promise<void>;
  onEditComment: (commentId: number, content: string) => Promise<void>;
  onDeleteComment: (commentId: number, threadId: number) => Promise<void>;
  onClose: () => void;
  readOnly?: boolean;
}

function formatCommentDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(getIntlLocale(), {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function resolveAuthor(
  authorId: string,
  membros: Membro[],
  workspaceUsers: WorkspaceUser[],
): { nome: string; avatar_url: string | null } | undefined {
  const wsUser = workspaceUsers.find((u) => u.id === authorId);
  if (wsUser) return { nome: wsUser.nome, avatar_url: wsUser.avatar_url };
  // `crm_user_id` is the membro's own login; `user_id` is whoever created the row.
  return membros.find((m) => m.crm_user_id === authorId);
}

function AuthorAvatar({
  membro,
}: {
  membro: { nome: string; avatar_url: string | null } | undefined;
}) {
  const { t } = useTranslation('postPanels');
  const name = membro?.nome ?? t('discussao.memberFallback');
  return (
    <PessoaAvatar
      nome={name}
      fotoUrl={membro?.avatar_url}
      alt={name}
      className="comment-avatar comment-avatar--initials"
    />
  );
}

function CommentItem({
  comment,
  membros,
  workspaceUsers,
  currentUserId,
  readOnly,
  onEdit,
  onDelete,
}: {
  comment: PostComment;
  membros: Membro[];
  workspaceUsers: WorkspaceUser[];
  currentUserId: string;
  readOnly?: boolean;
  onEdit: (commentId: number, content: string) => Promise<void>;
  onDelete: (commentId: number) => void;
}) {
  const { t } = useTranslation('postPanels');
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState(comment.content);
  const [saving, setSaving] = useState(false);
  const { can } = useAuth();

  const isAuthor = comment.author_id === currentUserId;
  // Was `currentUserRole === 'owner' || currentUserRole === 'admin'`.
  // Deleting SOMEONE ELSE's comment is moderation, not post-content editing:
  // `post_comments` DELETE RLS is tenant-only (no author/role predicate), so
  // this UI gate is the ONLY authorization boundary here -- `entregas:editar`
  // would have widened every legacy agent (AGENT_ROLE_PRESET.entregas is
  // 'editar') into deleting other people's comments, which the old
  // owner/admin-only check never allowed. `equipe:editar` reproduces the old
  // gate byte-for-byte for every legacy chassis role (AGENT_ROLE_PRESET.
  // equipe is 'none') and models moderation as a team-management capability,
  // matching MembrosTab/EquipePage's own gate for this module.
  const canDelete = isAuthor || can('equipe', 'editar') === true;
  const membro = resolveAuthor(comment.author_id, membros, workspaceUsers);

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
          <span className="comment-item-author">
            {membro?.nome ?? t('discussao.memberFallback')}
          </span>
          <span className="comment-item-date">{formatCommentDate(comment.created_at)}</span>
        </div>
        {!readOnly && !editing && (isAuthor || canDelete) && (
          <div className="comment-item-actions">
            {isAuthor && (
              <button
                className="comment-item-action"
                title={t('discussao.edit')}
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
                title={t('discussao.delete')}
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
          <MentionEditor
            className="comment-edit-input"
            value={editContent}
            onValueChange={setEditContent}
            disabled={saving}
            autoFocus
          />
          <div className="comment-edit-actions">
            <button
              className="comment-edit-save"
              onClick={handleSaveEdit}
              disabled={saving || !editContent.trim()}
            >
              {t('actions.save')}
            </button>
            <button className="comment-edit-cancel" onClick={handleCancelEdit} disabled={saving}>
              {t('actions.cancel')}
            </button>
          </div>
        </>
      ) : (
        <div className="comment-item-body">
          <p className="comment-item-content">
            <MentionText text={comment.content} />
          </p>
          {comment.updated_at && (
            <span className="comment-item-edited">{t('discussao.edited')}</span>
          )}
        </div>
      )}
    </div>
  );
}

export default function PostCommentPopover({
  thread,
  membros,
  workspaceUsers = [],
  currentUserId,
  onReply,
  onResolve,
  onReopen,
  onEditComment,
  onDeleteComment,
  onClose,
  readOnly,
}: PostCommentPopoverProps) {
  const { t } = useTranslation('postPanels');
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

  const replyTrimmed = replyContent.trim();
  const replyTooLong = replyTrimmed.length > DISCUSSAO_MAX_CHARS;

  const handleReply = useCallback(async () => {
    // Enter reaches here past the button's `disabled`, so the guards repeat it.
    if (!replyTrimmed || replyTooLong || submitting) return;
    setSubmitting(true);
    try {
      await onReply(thread.id, replyTrimmed);
      setReplyContent('');
    } catch {
      // The reply goes through `post_discussao_enviar`, which can reject (thread resolved
      // meanwhile, post gone, network). The typed text stays for a retry.
      toast.error(t('commentPopover.sendError'));
    } finally {
      setSubmitting(false);
    }
  }, [replyTrimmed, replyTooLong, submitting, onReply, thread.id, t]);

  const handleReplyKeyDown = (e: KeyboardEvent) => {
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
    if (window.confirm(t('commentPopover.deleteConfirm'))) {
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
              title={t('commentPopover.resolve')}
              onClick={handleResolve}
              disabled={submitting}
            >
              <Check size={14} />
            </button>
          )}
          {!readOnly && thread.status === 'resolved' && (
            <button
              className="comment-popover-action-btn"
              title={t('commentPopover.reopen')}
              onClick={handleReopen}
              disabled={submitting}
            >
              <RotateCcw size={14} />
            </button>
          )}
          <button className="comment-popover-action-btn" title={t('ui.close')} onClick={onClose}>
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
            workspaceUsers={workspaceUsers}
            currentUserId={currentUserId}
            readOnly={readOnly}
            onEdit={onEditComment}
            onDelete={handleDelete}
          />
        ))}
      </div>

      {!readOnly && thread.status === 'active' && (
        <div className="comment-popover-footer">
          <MentionEditor
            className="comment-reply-input"
            rootClassName="comment-reply-field"
            placeholder={t('commentPopover.replyPlaceholder')}
            value={replyContent}
            onValueChange={setReplyContent}
            onKeyDown={handleReplyKeyDown}
            disabled={submitting}
          />
          <button
            className="comment-reply-submit"
            onClick={handleReply}
            disabled={submitting || !replyTrimmed || replyTooLong}
          >
            {t('discussao.send')}
          </button>
        </div>
      )}
      {!readOnly && thread.status === 'active' && replyTooLong && (
        <p className="discussao-limit comment-popover-limit" role="alert">
          {t('discussao.tooLong', { max: DISCUSSAO_MAX_CHARS })}
        </p>
      )}
    </div>
  );
}
