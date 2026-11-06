import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { MentionEditor } from '@/components/mentions/MentionEditor';

export interface AddCommentPopoverProps {
  position: { top: number; left: number };
  onSubmit: (text: string) => Promise<void>;
  onClose: () => void;
  /** Elements whose mousedown must not count as "outside" (e.g. the trigger button). */
  ignoreRefs?: React.RefObject<HTMLElement | null>[];
  /** Extra class on the popover (the phone layout widens it to the screen). */
  className?: string;
}

/** "Adicionar comentário" popover shared by the content editor and the caption field. */
export function AddCommentPopover({
  position,
  onSubmit,
  onClose,
  ignoreRefs = [],
  className,
}: AddCommentPopoverProps) {
  const { t } = useTranslation('postPanels');
  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const ignoreRef = useRef(ignoreRefs);
  ignoreRef.current = ignoreRefs;

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (ignoreRef.current.some((r) => r.current?.contains(target))) return;
      onClose();
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [onClose]);

  const submit = async () => {
    const value = text.trim();
    if (!value || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(value);
    } catch {
      // The caller already reported the failure; stay open so the text is not lost.
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div
      ref={rootRef}
      className={className ? `comment-add-popover ${className}` : 'comment-add-popover'}
      style={{ position: 'fixed', top: position.top, left: position.left, zIndex: 9999 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="comment-add-label">{t('addComment.label')}</div>
      <MentionEditor
        className="comment-add-input"
        placeholder={t('addComment.placeholder')}
        value={text}
        onValueChange={setText}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
          if (e.key === 'Escape') onClose();
        }}
        autoFocus
      />
      <button
        type="button"
        className="comment-add-submit"
        onClick={() => void submit()}
        disabled={!text.trim() || submitting}
      >
        {t('addComment.submit')}
      </button>
    </div>,
    document.body,
  );
}
