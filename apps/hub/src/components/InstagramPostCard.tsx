import { useState, useRef, useCallback } from 'react';
import { CheckCircle, AlertCircle } from 'lucide-react';
import { submitApproval } from '../api';
import { formatDate } from './PostCard';
import { PostMediaLightbox } from './PostMediaLightbox';
import { OptimizedImage } from './OptimizedImage';
import { VideoPrewarm } from './VideoPrewarm';
import type { HubPost, PostApproval, InstagramProfile } from '../types';
import { useEditSuggestion } from '../hooks/useEditSuggestion';

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
  const [comentario, setComentario] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const [liked, setLiked] = useState(false);
  const touchStartX = useRef(0);
  const touchDelta = useRef(0);

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

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchDelta.current = 0;
  }, []);
  const onTouchMove = useCallback((e: React.TouchEvent) => {
    touchDelta.current = e.touches[0].clientX - touchStartX.current;
  }, []);
  const onTouchEnd = useCallback(() => {
    const MIN_SWIPE = 40;
    if (touchDelta.current < -MIN_SWIPE) nextSlide();
    else if (touchDelta.current > MIN_SWIPE) prevSlide();
  }, []);
  const displayName = instagramProfile?.username ?? workspaceName ?? '';
  const profilePic = instagramProfile?.profilePictureUrl;
  const effectiveIgCaption = isEditable ? draftIgCaption : post.ig_caption;
  const caption = effectiveIgCaption
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
    setCurrentSlide((i) => Math.max(0, i - 1));
  }
  function nextSlide() {
    setCurrentSlide((i) => Math.min(media.length - 1, i + 1));
  }

  const currentMedia = media[currentSlide];
  const prewarmVideoUrl = media.find((m) => m.kind === 'video')?.url ?? null;

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
      <div className="flex items-center px-2.5 py-2 gap-2 relative">
        {profilePic ? (
          <img src={profilePic} alt={displayName} className="w-6 h-6 rounded-full object-cover" />
        ) : (
          <div className="w-6 h-6 rounded-full bg-stone-200 dark:bg-stone-700 flex items-center justify-center text-[9px] font-bold text-stone-500 dark:text-stone-300">
            {displayName.charAt(0).toUpperCase()}
          </div>
        )}
        <span className="text-[11px] font-semibold text-[#262626] dark:text-[#f5f5f5] truncate">
          {displayName}
        </span>
      </div>

      {/* Image area */}
      <div
        className="relative aspect-[4/5] bg-stone-100 dark:bg-stone-900 group/carousel"
        onTouchStart={isCarousel ? onTouchStart : undefined}
        onTouchMove={isCarousel ? onTouchMove : undefined}
        onTouchEnd={isCarousel ? onTouchEnd : undefined}
      >
        {currentMedia && (
          <button
            type="button"
            onClick={() => setLightboxIdx(currentSlide)}
            className="w-full h-full"
          >
            {currentMedia.kind === 'image' ? (
              <OptimizedImage
                src={currentMedia.url}
                alt=""
                width={currentMedia.width ?? undefined}
                height={currentMedia.height ?? undefined}
                blurDataURL={currentMedia.blur_data_url ?? undefined}
                sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                priority={priority && currentSlide === 0}
                className="w-full h-full object-cover"
              />
            ) : (
              <img
                src={currentMedia.thumbnail_url ?? ''}
                alt=""
                className="w-full h-full object-cover"
              />
            )}
          </button>
        )}

        {currentMedia?.kind === 'video' && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-12 h-12 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="white">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
        )}

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
      <div className="flex justify-center gap-0.5 py-1.5 min-h-[18px]">
        {isCarousel &&
          media.map((_, i) => (
            <div
              key={i}
              data-carousel-dot
              className={`w-1 h-1 rounded-full ${i === currentSlide ? 'bg-[#0095f6]' : 'bg-[#c7c7c7] dark:bg-[#555]'}`}
            />
          ))}
      </div>

      {/* Action icons */}
      <div className={`px-2.5 ${isCarousel ? 'pt-0' : 'pt-1.5'} pb-0.5`}>
        <div className="flex items-center gap-2.5 text-[#262626] dark:text-[#f5f5f5]">
          <button
            type="button"
            onClick={() => setLiked((l) => !l)}
            className="transition-transform active:scale-125"
          >
            <svg
              width="18"
              height="18"
              fill={liked ? '#ed4956' : 'none'}
              stroke={liked ? '#ed4956' : 'currentColor'}
              strokeWidth="1.8"
              viewBox="0 0 24 24"
            >
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          </button>
          <svg
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            viewBox="0 0 24 24"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          <svg
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            viewBox="0 0 24 24"
          >
            <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" />
          </svg>
          <svg
            className="ml-auto"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            viewBox="0 0 24 24"
          >
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
          </svg>
        </div>
      </div>

      {/* Caption */}
      <div className="flex-1 flex flex-col px-2.5 py-1">
        {isEditable ? (
          <div className="flex-1">
            <p
              className={`text-[10px] mb-0.5 ${wasRejected ? 'text-amber-600' : 'text-stone-400'}`}
            >
              {wasRejected
                ? '⚠️ Sugestão rejeitada — edite novamente'
                : '✏️ Edite a legenda abaixo'}
            </p>
            <textarea
              defaultValue={caption}
              onChange={(e) => {
                saveSuggestion(draftConteudo, post.conteudo_plain, e.target.value);
              }}
              className="w-full text-[11px] text-[#262626] dark:text-[#f5f5f5] leading-[1.4] border border-dashed border-stone-300 dark:border-stone-600 rounded px-2 py-1.5 resize-none min-h-[48px] max-h-[96px] bg-transparent focus:outline-none focus:border-stone-400 focus:border-solid transition-colors"
            />
            {saveState !== 'idle' && (
              <div className="flex items-center gap-1 mt-0.5">
                {saveState === 'saving' && (
                  <span className="text-[10px] text-stone-400">Salvando...</span>
                )}
                {saveState === 'saved' && (
                  <>
                    <span className="w-1 h-1 rounded-full bg-emerald-500" />
                    <span className="text-[10px] text-emerald-600 font-medium">Sugestão salva</span>
                  </>
                )}
              </div>
            )}
          </div>
        ) : (
          <div
            className="flex-1 max-h-[72px] overflow-y-auto overscroll-contain"
            style={{ scrollbarWidth: 'thin' }}
          >
            <p className="text-[11px] text-[#262626] dark:text-[#f5f5f5] leading-[1.4]">
              <span className="font-semibold">{displayName}</span> {caption}
            </p>
          </div>
        )}
        <p className="text-[10px] text-[#737373] dark:text-[#a8a8a8] mt-1">
          Agendado: {formatDate(post.scheduled_at)}
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
                placeholder="Comentário (necessário para correção)…"
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
