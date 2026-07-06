import { useState, useRef, useEffect } from 'react';
import { CheckCircle, AlertCircle } from 'lucide-react';
import { submitApproval } from '../api';
import { formatDate } from './PostCard';
import { PostMediaLightbox } from './PostMediaLightbox';
import { OptimizedImage } from './OptimizedImage';
import { VideoPrewarm } from './VideoPrewarm';
import type { HubPost, PostApproval, InstagramProfile } from '../types';
import { useEditSuggestion } from '../hooks/useEditSuggestion';
import { resolveTarget, applyEdgeResistance, crossedDragThreshold } from '../lib/carouselGesture';

/** Caption length (chars) above which we collapse it behind a "mais"/"ver menos" toggle (~2 lines). */
const CAPTION_CLAMP_CHARS = 140;

/** Snap animation duration for the media carousel, disabled under reduced-motion / active drag. */
const SNAP_MS = 260;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

interface InstagramPostCardProps {
  post: HubPost;
  token: string;
  approvals: PostApproval[];
  instagramProfile: InstagramProfile | null;
  workspaceName?: string;
  isSelected?: boolean;
  onToggleSelect?: (postId: number) => void;
  onApprovalSubmitted?: () => void;
  readOnly?: boolean;
  /** Mark the first visible card's image as LCP priority */
  priority?: boolean;
  autoPublishOnApproval?: boolean;
}

export function InstagramPostCard({
  post,
  token,
  approvals,
  instagramProfile,
  workspaceName,
  isSelected,
  onToggleSelect,
  onApprovalSubmitted,
  readOnly,
  priority,
  autoPublishOnApproval = false,
}: InstagramPostCardProps) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [dragOffset, setDragOffset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [comentario, setComentario] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [liked, setLiked] = useState(false);
  const [captionExpanded, setCaptionExpanded] = useState(false);
  const [captionMode, setCaptionMode] = useState<'preview' | 'edit'>('preview');
  const [captionDraft, setCaptionDraft] = useState<string | null>(null);

  const viewportRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({
    pointerId: -1,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastT: 0,
    width: 0,
    velocity: 0,
    active: false,
    decided: false,
  });
  const suppressClickRef = useRef(false);

  const isPending = !readOnly && post.status === 'enviado_cliente';
  const media = post.media ?? [];
  const isCarousel = media.length > 1;

  const {
    isEditable: canEdit,
    hasPendingSuggestion,
    wasRejected,
    saveSuggestion,
    saveState,
    approvalBlocked,
    draftConteudo,
    draftIgCaption,
  } = useEditSuggestion({
    token,
    post,
    onSaved: () => onApprovalSubmitted?.(),
  });
  const isEditable = canEdit && !readOnly;

  function goToSlide(target: number) {
    setCurrentSlide(Math.max(0, Math.min(media.length - 1, target)));
    setDragOffset(0);
    setIsDragging(false);
  }

  function onPointerDown(e: React.PointerEvent) {
    // A fresh gesture must never start pre-suppressed: if a previous drag ended
    // without the browser synthesizing a click (e.g. released outside a slide),
    // the flag could otherwise latch and swallow this tap.
    suppressClickRef.current = false;
    if (media.length <= 1) return;
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastT: e.timeStamp,
      width: viewportRef.current?.clientWidth ?? 0,
      velocity: 0,
      active: true,
      decided: false,
    };
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d.active || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.decided) {
      // Let a clearly vertical gesture fall through to page scroll; wait for horizontal intent.
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) {
        d.active = false;
        return;
      }
      if (!crossedDragThreshold(dx, dy)) return;
      d.decided = true;
      setIsDragging(true);
      viewportRef.current?.setPointerCapture?.(e.pointerId);
    }
    d.velocity = (e.clientX - d.lastX) / Math.max(1, e.timeStamp - d.lastT);
    d.lastX = e.clientX;
    d.lastT = e.timeStamp;
    setDragOffset(applyEdgeResistance(dx, currentSlide, media.length));
  }

  function endPointer(e: React.PointerEvent, cancelled: boolean) {
    const d = dragRef.current;
    if (!d.active || e.pointerId !== d.pointerId) return;
    d.active = false;
    if (!d.decided) {
      setDragOffset(0);
      setIsDragging(false);
      return;
    }
    // A drag happened — swallow the click that browsers synthesize after pointerup.
    suppressClickRef.current = true;
    if (cancelled) {
      goToSlide(currentSlide);
      return;
    }
    goToSlide(
      resolveTarget({
        currentIndex: currentSlide,
        count: media.length,
        deltaX: e.clientX - d.startX,
        width: d.width,
        velocity: d.velocity,
      }),
    );
  }

  function openLightboxAt(index: number) {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    setLightboxIdx(index);
  }

  const displayName = instagramProfile?.username ?? workspaceName ?? '';
  const profilePic = instagramProfile?.profilePictureUrl;
  const effectiveIgCaption = isEditable ? draftIgCaption : post.ig_caption;
  const serverCaption = effectiveIgCaption
    ? effectiveIgCaption
    : (() => {
        const rawText = post.conteudo_plain || '';
        const legendaIdx = rawText.toUpperCase().indexOf('LEGENDA');
        return legendaIdx !== -1
          ? rawText
              .slice(legendaIdx + 'LEGENDA'.length)
              .replace(/^[:\s\n]+/, '')
              .trim()
          : rawText;
      })();
  // Locally-controlled draft keeps the preview stable while the debounced save/refetch is in flight.
  const caption = captionDraft ?? serverCaption;

  // Adopt a fresh server caption only when it actually changes and the client is
  // not mid-edit — so "Concluir" keeps showing the local draft until the debounced
  // save round-trips (avoids a flash of the pre-edit text).
  const lastSyncedCaption = useRef<string | null>(null);
  useEffect(() => {
    if (lastSyncedCaption.current !== serverCaption) {
      lastSyncedCaption.current = serverCaption;
      if (captionMode !== 'edit') setCaptionDraft(null);
    }
  }, [serverCaption, captionMode]);

  // A card that becomes read-only after approval must never stay in edit mode.
  useEffect(() => {
    if (readOnly || !canEdit) setCaptionMode('preview');
  }, [readOnly, canEdit]);

  async function handleAction(action: 'aprovado' | 'correcao') {
    setSubmitting(true);
    setResult(null);
    try {
      const res = await submitApproval(token, post.id, action, comentario || undefined);
      const message =
        action === 'aprovado'
          ? res.scheduled
            ? 'Post aprovado e agendado para publicação!'
            : 'Post aprovado!'
          : 'Correção enviada!';
      setResult({ type: 'success', message });
      onApprovalSubmitted?.();
    } catch (e) {
      setResult({ type: 'error', message: (e as Error).message });
    } finally {
      setSubmitting(false);
    }
  }

  function prevSlide() {
    goToSlide(currentSlide - 1);
  }
  function nextSlide() {
    goToSlide(currentSlide + 1);
  }

  const prewarmVideoUrl = media.find((m) => m.kind === 'video')?.url ?? null;
  const viewportWidth = viewportRef.current?.clientWidth ?? 0;
  // Fractional position drives the dots so the next dot lights up mid-drag.
  const fractionalSlide =
    isDragging && viewportWidth > 0 ? currentSlide - dragOffset / viewportWidth : currentSlide;
  const reduceMotion = prefersReducedMotion();

  return (
    <div
      className={`relative flex flex-col h-full bg-white dark:bg-[#1a1a1a] rounded-xl overflow-hidden transition-all ${isSelected ? 'border-[1.5px] border-[#0095f6] shadow-[0_0_0_2px_rgba(0,149,246,0.2)]' : 'shadow-[0_1px_3px_rgba(0,0,0,0.08),0_4px_12px_rgba(0,0,0,0.04)]'}`}
      style={{
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      }}
    >
      <VideoPrewarm src={prewarmVideoUrl} />
      {/* Selection checkbox */}
      {onToggleSelect && (
        <div className="absolute top-0 right-0 z-10">
          <button
            type="button"
            role="checkbox"
            aria-checked={isSelected}
            aria-label="Selecionar publicação"
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect(post.id);
            }}
            className="w-11 h-11 flex items-start justify-end p-2 cursor-pointer"
          >
            <span
              className={`w-6 h-6 rounded-full flex items-center justify-center shadow-md ${isSelected ? 'bg-[#0095f6]' : 'bg-black/30 dark:bg-white/20 border-2 border-white dark:border-white/60'}`}
            >
              <svg
                width="12"
                height="12"
                fill="none"
                stroke="#fff"
                strokeWidth="2.5"
                viewBox="0 0 24 24"
              >
                <path d="M5 13l4 4L19 7" />
              </svg>
            </span>
          </button>
        </div>
      )}

      {/* Profile header */}
      <div className="flex items-center px-3 py-2.5 gap-2.5 relative">
        <span className="shrink-0 rounded-full bg-gradient-to-tr from-[#feda75] via-[#d62976] to-[#4f5bd5] p-[2px]">
          <span className="block rounded-full bg-white dark:bg-[#1a1a1a] p-[2px]">
            {profilePic ? (
              <img
                src={profilePic}
                alt={displayName}
                className="w-8 h-8 rounded-full object-cover"
              />
            ) : (
              <span className="w-8 h-8 rounded-full bg-stone-200 dark:bg-stone-700 flex items-center justify-center text-[11px] font-bold text-stone-500 dark:text-stone-300">
                {displayName.charAt(0).toUpperCase()}
              </span>
            )}
          </span>
        </span>
        <span className="text-[14px] font-semibold text-[#262626] dark:text-[#f5f5f5] truncate leading-none">
          {displayName}
        </span>
        {!onToggleSelect && (
          <svg
            className="ml-auto text-[#262626] dark:text-[#f5f5f5]"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <circle cx="5" cy="12" r="1.6" />
            <circle cx="12" cy="12" r="1.6" />
            <circle cx="19" cy="12" r="1.6" />
          </svg>
        )}
      </div>

      {/* Image area — finger-following carousel track */}
      <div
        ref={viewportRef}
        className="relative aspect-[4/5] bg-stone-100 dark:bg-stone-900 overflow-hidden group/carousel"
        style={{ touchAction: 'pan-y' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => endPointer(e, false)}
        onPointerCancel={(e) => endPointer(e, true)}
      >
        <div
          className="flex h-full"
          style={{
            transform: `translateX(calc(${-currentSlide * 100}% + ${dragOffset}px))`,
            transition: isDragging || reduceMotion ? 'none' : `transform ${SNAP_MS}ms ease-out`,
          }}
        >
          {media.map((m, i) => (
            <button
              key={m.id}
              type="button"
              aria-label={`Abrir mídia ${i + 1}`}
              onClick={() => openLightboxAt(i)}
              draggable={false}
              className="relative flex-none w-full h-full"
            >
              {m.kind === 'image' ? (
                <OptimizedImage
                  src={m.url}
                  alt=""
                  width={m.width ?? undefined}
                  height={m.height ?? undefined}
                  blurDataURL={m.blur_data_url ?? undefined}
                  sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                  priority={priority && i === 0}
                  className="w-full h-full object-cover pointer-events-none"
                />
              ) : (
                <img
                  src={m.thumbnail_url ?? ''}
                  alt=""
                  draggable={false}
                  className="w-full h-full object-cover pointer-events-none"
                />
              )}
              {m.kind === 'video' && (
                <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <span className="w-12 h-12 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </span>
                </span>
              )}
            </button>
          ))}
        </div>

        {isCarousel && currentSlide > 0 && (
          <button
            onClick={prevSlide}
            aria-label="Slide anterior"
            className="absolute left-0 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center text-[#262626] dark:text-white opacity-100 md:opacity-0 md:group-hover/carousel:opacity-100 transition-opacity"
          >
            <span className="w-7 h-7 rounded-full bg-white/80 dark:bg-black/60 flex items-center justify-center shadow-sm">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </span>
          </button>
        )}
        {isCarousel && currentSlide < media.length - 1 && (
          <button
            onClick={nextSlide}
            aria-label="Próximo slide"
            className="absolute right-0 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center text-[#262626] dark:text-white opacity-100 md:opacity-0 md:group-hover/carousel:opacity-100 transition-opacity"
          >
            <span className="w-7 h-7 rounded-full bg-white/80 dark:bg-black/60 flex items-center justify-center shadow-sm">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <path d="M9 18l6-6-6-6" />
              </svg>
            </span>
          </button>
        )}
      </div>

      {/* Carousel dots (fixed height so feed and carousel cards match) */}
      <div className="flex justify-center gap-1 py-2 min-h-[20px]">
        {isCarousel &&
          media.map((_, i) => {
            const distance = Math.min(1, Math.abs(i - fractionalSlide));
            const active = distance < 0.5;
            return (
              <div
                key={i}
                data-carousel-dot
                className={`h-1.5 rounded-full transition-[width,background-color] ${
                  active ? 'w-2 bg-[#0095f6]' : 'w-1.5 bg-[#c7c7c7] dark:bg-[#555]'
                }`}
                style={{ opacity: 0.5 + (1 - distance) * 0.5 }}
              />
            );
          })}
      </div>

      {/* Action icons */}
      <div className={`px-3 ${isCarousel ? 'pt-0.5' : 'pt-2'} pb-1`}>
        <div className="flex items-center gap-4 text-[#262626] dark:text-[#f5f5f5]">
          <button
            type="button"
            aria-label="Curtir"
            onClick={() => setLiked((l) => !l)}
            className="transition-transform active:scale-125"
          >
            <svg
              width="24"
              height="24"
              fill={liked ? '#ed4956' : 'none'}
              stroke={liked ? '#ed4956' : 'currentColor'}
              strokeWidth="1.7"
              viewBox="0 0 24 24"
            >
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </button>
          <svg
            width="24"
            height="24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            viewBox="0 0 24 24"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <svg
            width="24"
            height="24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            viewBox="0 0 24 24"
          >
            <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
          </svg>
          <svg
            className="ml-auto"
            width="24"
            height="24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            viewBox="0 0 24 24"
          >
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
          </svg>
        </div>
      </div>

      {/* Caption — read-first, with an opt-in inline editor for pending posts */}
      <div className="flex-1 flex flex-col px-2.5 py-1">
        {isEditable && captionMode === 'edit' ? (
          <div className="flex-1">
            <p
              className={`text-[10px] mb-0.5 ${wasRejected ? 'text-amber-600' : 'text-stone-400'}`}
            >
              {wasRejected
                ? '⚠️ Sugestão rejeitada — edite novamente'
                : '✏️ Edite a legenda abaixo'}
            </p>
            <textarea
              aria-label="Legenda do post"
              value={caption}
              onChange={(e) => {
                setCaptionDraft(e.target.value);
                saveSuggestion(draftConteudo, post.conteudo_plain, e.target.value);
              }}
              className="w-full text-[14px] text-[#262626] dark:text-[#f5f5f5] leading-[1.4] border border-dashed border-stone-300 dark:border-stone-600 rounded px-2 py-1.5 resize-none min-h-[72px] max-h-[160px] bg-transparent focus:outline-none focus:border-stone-400 focus:border-solid transition-colors"
            />
            <div className="flex items-center justify-between mt-0.5">
              <span className="flex items-center gap-1 min-h-[16px]">
                {saveState === 'saving' && (
                  <span className="text-[10px] text-stone-400">Salvando...</span>
                )}
                {saveState === 'saved' && (
                  <>
                    <span className="w-1 h-1 rounded-full bg-emerald-500" />
                    <span className="text-[10px] text-emerald-600 font-medium">Sugestão salva</span>
                  </>
                )}
              </span>
              <button
                type="button"
                onClick={() => setCaptionMode('preview')}
                className="text-[13px] font-semibold text-[#0095f6] hover:text-[#0081d6] transition-colors"
              >
                Concluir
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1">
            <p
              className={`text-[14px] text-[#262626] dark:text-[#f5f5f5] leading-[1.35] whitespace-pre-wrap ${captionExpanded ? '' : 'line-clamp-2'}`}
            >
              <span className="font-semibold">{displayName}</span> {caption}
            </p>
            {caption.length > CAPTION_CLAMP_CHARS && (
              <button
                type="button"
                onClick={() => setCaptionExpanded((v) => !v)}
                className="mt-0.5 text-[14px] text-[#8e8e8e] hover:text-[#5a5a5a] dark:hover:text-[#c7c7c7] transition-colors"
              >
                {captionExpanded ? 'ver menos' : '… mais'}
              </button>
            )}
            {isEditable && (
              <button
                type="button"
                onClick={() => setCaptionMode('edit')}
                className="mt-1 self-start text-[13px] font-medium text-[#0095f6] hover:text-[#0081d6] transition-colors"
              >
                Editar legenda
              </button>
            )}
          </div>
        )}
        <p className="text-[10px] uppercase tracking-wide text-[#8e8e8e] dark:text-[#a8a8a8] mt-1.5">
          Agendado · {formatDate(post.scheduled_at)}
        </p>
      </div>

      {/* Agendado banner */}
      {post.status === 'agendado' && post.scheduled_at && (
        <div
          style={{
            padding: '0.75rem 1rem',
            borderTop: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            background: 'rgba(62, 207, 142, 0.03)',
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              background: '#3ecf8e',
              borderRadius: '50%',
              flexShrink: 0,
            }}
          />
          <div>
            <div style={{ color: '#3ecf8e', fontSize: '0.8rem', fontWeight: 600 }}>
              Agendado para publicação
            </div>
            <div style={{ color: 'var(--text-light)', fontSize: '0.75rem' }}>
              {new Date(post.scheduled_at).toLocaleDateString('pt-BR', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </div>
          </div>
        </div>
      )}

      {/* Postado banner */}
      {post.status === 'postado' && (
        <div
          style={{
            padding: '0.75rem 1rem',
            borderTop: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(234, 179, 8, 0.03)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ color: '#eab308', fontSize: '0.9rem' }}>✓</span>
            <div>
              <div style={{ color: '#eab308', fontSize: '0.8rem', fontWeight: 600 }}>Publicado</div>
              {post.published_at && (
                <div style={{ color: 'var(--text-light)', fontSize: '0.75rem' }}>
                  {new Date(post.published_at).toLocaleDateString('pt-BR', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </div>
              )}
            </div>
          </div>
          {post.instagram_permalink && (
            <a
              href={post.instagram_permalink}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: '#E1306C',
                fontSize: '0.75rem',
                fontWeight: 500,
                textDecoration: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '0.3rem',
              }}
            >
              Ver no Instagram <span style={{ fontSize: '0.7rem' }}>↗</span>
            </a>
          )}
        </div>
      )}

      {/* Approval buttons */}
      {isPending && !result && (
        <div className="border-t border-[#efefef] dark:border-[#262626] px-2.5 py-2 space-y-1.5">
          {hasPendingSuggestion ? (
            <div className="rounded px-3 py-2 text-[11px] font-medium bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 ring-1 ring-amber-200/60 text-center">
              Sugestão enviada para revisão
            </div>
          ) : (
            <>
              <textarea
                value={comentario}
                onChange={(e) => setComentario(e.target.value)}
                placeholder="Comente aqui ou corrija o texto diretamente no campo acima"
                className="w-full rounded border border-stone-200 dark:border-[#333] px-2.5 py-1.5 text-[11px] resize-none min-h-[48px] bg-white dark:bg-[#0a0a0a] text-stone-900 dark:text-[#f5f5f5] placeholder:text-stone-400 dark:placeholder:text-[#666] focus:outline-none focus:border-stone-300 dark:focus:border-[#555] transition-all"
              />
              <div className="flex gap-1.5">
                <button
                  onClick={() => handleAction('aprovado')}
                  disabled={submitting || approvalBlocked}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 min-h-[44px] rounded-[4px] bg-stone-900 text-white text-[13px] font-semibold hover:bg-stone-800 disabled:opacity-50 transition-colors"
                >
                  <CheckCircle size={16} /> {saveState === 'saving' ? 'Salvando...' : 'Aprovar'}
                </button>
                <button
                  onClick={() => handleAction('correcao')}
                  disabled={submitting || approvalBlocked || !comentario.trim()}
                  title={
                    !comentario.trim() ? 'Deixe um comentário para solicitar correção' : undefined
                  }
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 min-h-[44px] rounded-[4px] border border-stone-200 dark:border-stone-700 bg-white dark:bg-transparent text-stone-700 dark:text-stone-300 text-[13px] font-medium hover:bg-stone-50 dark:hover:bg-stone-800 disabled:opacity-50 transition-colors"
                >
                  <AlertCircle size={16} /> Correção
                </button>
              </div>
            </>
          )}
          {autoPublishOnApproval && isPending && (
            <div
              style={{
                marginTop: '0.75rem',
                padding: '0.6rem',
                background: post.scheduled_at
                  ? 'rgba(234, 179, 8, 0.06)'
                  : 'rgba(62, 207, 142, 0.06)',
                border: `1px solid ${post.scheduled_at ? 'rgba(234, 179, 8, 0.19)' : 'rgba(62, 207, 142, 0.19)'}`,
                borderRadius: 6,
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.4rem',
              }}
            >
              <span
                style={{
                  color: post.scheduled_at ? '#eab308' : '#3ecf8e',
                  fontSize: '0.8rem',
                  flexShrink: 0,
                }}
              >
                ⚡
              </span>
              <div
                style={{
                  color: post.scheduled_at ? '#eab308' : '#3ecf8e',
                  fontSize: '0.7rem',
                  lineHeight: 1.4,
                }}
              >
                {post.scheduled_at ? (
                  <>
                    Ao aprovar, este post será publicado automaticamente no Instagram em{' '}
                    <strong>
                      {new Date(post.scheduled_at).toLocaleDateString('pt-BR', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </strong>
                    .
                  </>
                ) : (
                  'Ao aprovar, este post será agendado para publicação automática no Instagram.'
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {result && (
        <div
          className={`mx-2.5 mb-2 rounded-lg px-3 py-2 text-[11px] font-medium ${result.type === 'success' ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300' : 'bg-rose-50 dark:bg-rose-950/50 text-rose-800 dark:text-rose-300'}`}
        >
          {result.message}
        </div>
      )}

      {lightboxIdx !== null && media.length > 0 && (
        <PostMediaLightbox
          media={media}
          initialIndex={lightboxIdx}
          onClose={() => setLightboxIdx(null)}
          onStaleUrl={onApprovalSubmitted}
        />
      )}
    </div>
  );
}
