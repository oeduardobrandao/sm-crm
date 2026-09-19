import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { Instagram, Lock, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import type { CaptionAnchorPatch, CommentAnchor, CommentThreadWithComments, Membro } from '@/store';
import { buildMirrorSegments, pickThreadId } from '../utils/captionAnchors';
import PostCommentPopover from './PostCommentPopover';
import { AddCommentPopover } from './AddCommentPopover';
import { MAX_CAPTION_CHARS, useCaptionDraft } from './useCaptionDraft';

export interface CaptionCommentHandlers {
  membros: Membro[];
  workspaceUsers: { id: string; nome: string; avatar_url: string }[];
  currentUserId: string;
  onCreateThread: (quotedText: string, comment: string, anchor: CommentAnchor) => Promise<number>;
  onReply: (threadId: number, content: string) => Promise<void>;
  onResolve: (threadId: number) => Promise<void>;
  onReopen: (threadId: number) => Promise<void>;
  onEditComment: (commentId: number, content: string) => Promise<void>;
  onDeleteComment: (commentId: number, threadId: number) => Promise<void>;
}

export interface InstagramCaptionFieldHandle {
  focusThread(threadId: number): void;
}

interface InstagramCaptionFieldProps {
  value: string;
  threads: CommentThreadWithComments[];
  /** Locked (e.g. scheduled): the textarea is readOnly, but commenting still works. */
  disabled?: boolean;
  lockedMessage?: string;
  onSave: (text: string, anchors: CaptionAnchorPatch[]) => Promise<void>;
  comments?: CaptionCommentHandlers;
}

const POPOVER_W = 320;
const POPOVER_H = 400;

// Same box, font and wrapping classes as the textarea so the mirror wraps identically.
const FIELD_CLASS = 'min-h-[80px] w-full rounded-md border px-3 py-2 text-base md:text-sm';
const FIELD_STYLE = { fontFamily: 'var(--font-mono)', fontSize: '0.85rem' } as const;

export const InstagramCaptionField = forwardRef<
  InstagramCaptionFieldHandle,
  InstagramCaptionFieldProps
>(function InstagramCaptionField(
  { value, threads, disabled, lockedMessage, onSave, comments },
  ref,
) {
  const { text, anchors, change, flush, getText } = useCaptionDraft({ value, threads, onSave });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const lastWidthRef = useRef<number | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const commentBtnRef = useRef<HTMLButtonElement>(null);

  const [selection, setSelection] = useState<{ start: number; end: number } | null>(null);
  const [adding, setAdding] = useState<{
    start: number;
    end: number;
    quoted: string;
    top: number;
    left: number;
  } | null>(null);
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);

  const threadsById = useMemo(() => new Map(threads.map((t) => [t.id, t])), [threads]);

  const paintable = useMemo(
    () =>
      anchors
        .filter((a) => !a.orphaned && threadsById.get(a.id)?.status === 'active')
        .map((a) => ({ id: a.id, start: a.start, end: a.end })),
    [anchors, threadsById],
  );
  const segments = useMemo(() => buildMirrorSegments(text, paintable), [text, paintable]);

  // ── auto-grow (unchanged behavior: no inner scroll, height follows content) ──
  const resize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };
  useEffect(() => {
    resize();
  }, [text]);
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width === undefined) return;
      if (lastWidthRef.current !== null && Math.abs(width - lastWidthRef.current) < 0.5) return;
      lastWidthRef.current = width;
      resize();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── selection tracking (drives the header "Comentar" button) ──
  const syncSelection = () => {
    const el = textareaRef.current;
    if (!el) return;
    setSelection(
      el.selectionStart !== el.selectionEnd
        ? { start: el.selectionStart, end: el.selectionEnd }
        : null,
    );
  };

  // ── thread popover placement + outside click ──
  const placeNear = (rect: { top: number; bottom: number; left: number }) => {
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - POPOVER_W - 16));
    const top =
      rect.bottom + 6 + POPOVER_H > window.innerHeight
        ? Math.max(8, rect.top - POPOVER_H - 6)
        : rect.bottom + 6;
    return { top, left };
  };

  const openThread = (threadId: number) => {
    const mark = mirrorRef.current?.querySelector(`mark[data-thread-ids~="${threadId}"]`);
    const rect = (mark ?? textareaRef.current)?.getBoundingClientRect();
    if (!rect) return;
    setPopoverPos(placeNear(rect));
    setActiveThreadId(threadId);
    setAdding(null);
  };

  useEffect(() => {
    if (activeThreadId == null) return;
    const onMouseDown = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setActiveThreadId(null);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [activeThreadId]);

  const handleClick = (e: ReactMouseEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    if (el.selectionStart !== el.selectionEnd) return; // end of a drag-select, not a click
    const hits: number[][] = [];
    mirrorRef.current?.querySelectorAll<HTMLElement>('mark[data-thread-ids]').forEach((mark) => {
      const inside = Array.from(mark.getClientRects()).some(
        (r) =>
          e.clientX >= r.left &&
          e.clientX <= r.right &&
          e.clientY >= r.top &&
          e.clientY <= r.bottom,
      );
      if (inside) hits.push((mark.dataset.threadIds ?? '').split(' ').map(Number));
    });
    const id = pickThreadId(hits);
    if (id != null && comments) openThread(id);
  };

  useImperativeHandle(
    ref,
    () => ({
      focusThread(threadId: number) {
        const el = textareaRef.current;
        if (!el) return;
        el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
        const a = anchors.find((x) => x.id === threadId);
        if (a && !a.orphaned) {
          el.focus({ preventScroll: true });
          el.setSelectionRange(a.start, a.end);
        }
        if (comments) openThread(threadId);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [anchors, comments],
  );

  // ── add comment ──
  const openAdd = (e: ReactMouseEvent<HTMLButtonElement>) => {
    if (!selection || !comments) return;
    const quoted = text.slice(selection.start, selection.end);
    if (!quoted.trim()) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - 280 - 16));
    setAdding({ ...selection, quoted, top: rect.bottom + 6, left });
    setActiveThreadId(null);
  };

  const submitAdd = async (comment: string) => {
    if (!adding || !comments) return;
    // The new thread row must reference text the server already has.
    // (a failed save is already toasted by the drawer's onSave)
    const saved = await flush();
    if (!saved) return;
    if (getText().slice(adding.start, adding.end) !== adding.quoted) {
      toast.error('O texto mudou. Selecione o trecho de novo.');
      setAdding(null);
      return;
    }
    try {
      await comments.onCreateThread(adding.quoted, comment, {
        field: 'ig_caption',
        start: adding.start,
        end: adding.end,
      });
    } catch (err) {
      toast.error('Não foi possível criar o comentário.');
      // Reject so AddCommentPopover stays open and the typed comment is not lost.
      throw err;
    }
    setAdding(null);
    setSelection(null);
  };

  const activeThread = activeThreadId != null ? threadsById.get(activeThreadId) : undefined;

  return (
    <div
      className="mt-3 rounded-lg border-2 p-3"
      style={{ borderColor: 'var(--border-color)', background: 'var(--surface-hover)' }}
    >
      <div className="flex items-center gap-2 mb-2">
        <Instagram className="h-4 w-4" style={{ color: '#E1306C' }} />
        <span className="text-sm font-semibold" style={{ color: 'var(--text-main)' }}>
          Legenda do Instagram
        </span>
        {disabled && lockedMessage && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Lock
                  className={comments ? 'h-3.5 w-3.5' : 'h-3.5 w-3.5 ml-auto'}
                  style={{ color: 'var(--text-light)' }}
                />
              </TooltipTrigger>
              <TooltipContent>{lockedMessage}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        {comments && (
          <span
            className="ml-auto"
            title={selection ? undefined : 'Selecione um trecho da legenda para comentar'}
          >
            <Button
              ref={commentBtnRef}
              type="button"
              variant="ghost"
              size="sm"
              className="mb-0 h-7 gap-1 px-2 text-xs"
              disabled={!selection}
              onMouseDown={(e) => e.preventDefault()}
              onClick={openAdd}
            >
              <MessageSquare className="h-3.5 w-3.5" />
              Comentar
            </Button>
          </span>
        )}
        <span
          className={comments ? 'text-xs' : 'ml-auto text-xs'}
          style={{ color: 'var(--text-light)', fontFamily: 'var(--font-mono)' }}
        >
          {text.length} / {MAX_CAPTION_CHARS}
        </span>
      </div>

      <div className="relative rounded-md bg-background">
        <div
          ref={mirrorRef}
          aria-hidden="true"
          className={`caption-mirror pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap border-transparent ${FIELD_CLASS}`}
          style={FIELD_STYLE}
        >
          {segments.map((seg, i) =>
            seg.threadIds.length ? (
              <mark key={i} className="comment-highlight" data-thread-ids={seg.threadIds.join(' ')}>
                {seg.text}
              </mark>
            ) : (
              <span key={i}>{seg.text}</span>
            ),
          )}
          {'\u200B'}
        </div>
        <Textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => {
            if (!disabled) change(e.target.value); // readOnly can still fire onChange in tests
          }}
          onSelect={syncSelection}
          onKeyUp={syncSelection}
          onMouseUp={syncSelection}
          onClick={handleClick}
          readOnly={disabled}
          placeholder="Texto exato que será publicado no Instagram. Suporta emojis e hashtags."
          className="relative min-h-[80px] resize-none overflow-hidden bg-transparent read-only:cursor-default read-only:opacity-70"
          style={FIELD_STYLE}
        />
      </div>
      <p className="text-xs mt-1" style={{ color: 'var(--text-light)' }}>
        Texto exato que será publicado no Instagram. Suporta emojis e hashtags.
      </p>

      {adding && comments && (
        <AddCommentPopover
          position={{ top: adding.top, left: adding.left }}
          onSubmit={submitAdd}
          onClose={() => setAdding(null)}
          ignoreRefs={[commentBtnRef]}
        />
      )}

      {activeThread &&
        popoverPos &&
        comments &&
        createPortal(
          <div
            ref={popoverRef}
            style={{ position: 'fixed', top: popoverPos.top, left: popoverPos.left, zIndex: 9999 }}
          >
            <PostCommentPopover
              thread={activeThread}
              membros={comments.membros}
              workspaceUsers={comments.workspaceUsers}
              currentUserId={comments.currentUserId}
              onReply={comments.onReply}
              onResolve={comments.onResolve}
              onReopen={comments.onReopen}
              onEditComment={comments.onEditComment}
              onDeleteComment={comments.onDeleteComment}
              onClose={() => setActiveThreadId(null)}
            />
          </div>,
          document.body,
        )}
    </div>
  );
});
