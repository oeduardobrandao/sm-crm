import { useState } from 'react';
import { CheckCircle, AlertCircle } from 'lucide-react';
import { submitApproval } from '../api';
import { formatDate } from './PostCard';
import { PostMediaLightbox } from './PostMediaLightbox';
import type { HubPost, PostApproval, InstagramProfile } from '../types';

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
}

export function InstagramPostCard({
  post, token, approvals, instagramProfile, workspaceName,
  isSelected, onToggleSelect, onApprovalSubmitted, readOnly,
}: InstagramPostCardProps) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [captionExpanded, setCaptionExpanded] = useState(false);
  const [comentario, setComentario] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  const isPending = !readOnly && post.status === 'enviado_cliente';
  const media = post.media ?? [];
  const isCarousel = media.length > 1;
  const displayName = instagramProfile?.username ?? workspaceName ?? '';
  const profilePic = instagramProfile?.profilePictureUrl;
  const rawText = post.conteudo_plain ?? '';
  const legendaIdx = rawText.toUpperCase().indexOf('LEGENDA');
  const caption = legendaIdx !== -1
    ? rawText.slice(legendaIdx + 'LEGENDA'.length).replace(/^[:\s\n]+/, '').trim()
    : rawText;
  const truncatedCaption = caption.length > 125 ? caption.slice(0, 125) + '...' : caption;

  async function handleAction(action: 'aprovado' | 'correcao') {
    setSubmitting(true);
    setResult(null);
    try {
      await submitApproval(token, post.id, action, comentario || undefined);
      setResult({ type: 'success', message: action === 'aprovado' ? 'Post aprovado!' : 'Correção enviada!' });
      onApprovalSubmitted?.();
    } catch (e) {
      setResult({ type: 'error', message: (e as Error).message });
    } finally {
      setSubmitting(false);
    }
  }

  function prevSlide() { setCurrentSlide(i => Math.max(0, i - 1)); }
  function nextSlide() { setCurrentSlide(i => Math.min(media.length - 1, i + 1)); }

  const currentMedia = media[currentSlide];

  return (
    <div
      className={`relative bg-white dark:bg-[#1a1a1a] rounded-xl overflow-hidden border-[1.5px] transition-all ${isSelected ? 'border-[#0095f6] shadow-[0_0_0_2px_rgba(0,149,246,0.2)]' : 'border-[#dbdbdb] dark:border-[#262626]'}`}
      style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' }}
    >
      {/* Selection checkbox */}
      {onToggleSelect && (
        <div className="absolute top-2 right-2 z-10">
          <button
            type="button"
            role="checkbox"
            aria-checked={isSelected}
            onClick={(e) => { e.stopPropagation(); onToggleSelect(post.id); }}
            className={`w-5 h-5 rounded-full flex items-center justify-center cursor-pointer shadow-md ${isSelected ? 'bg-[#0095f6]' : 'bg-black/30 dark:bg-white/20 border-2 border-white dark:border-white/60'}`}
          >
            <svg width="10" height="10" fill="none" stroke="#fff" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>
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
        <span className="text-[11px] font-semibold text-[#262626] dark:text-[#f5f5f5] truncate">{displayName}</span>
        <span className="ml-auto text-[#262626] dark:text-[#f5f5f5] text-xs">•••</span>
      </div>

      {/* Image area */}
      <div className="relative aspect-[4/5] bg-stone-100 dark:bg-stone-900">
        {currentMedia && (
          <button type="button" onClick={() => setLightboxIdx(currentSlide)} className="w-full h-full">
            {currentMedia.kind === 'image' ? (
              <img src={currentMedia.url} alt="" className="w-full h-full object-cover" />
            ) : (
              <img src={currentMedia.thumbnail_url ?? ''} alt="" className="w-full h-full object-cover" />
            )}
          </button>
        )}

        {currentMedia?.kind === 'video' && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-12 h-12 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
            </div>
          </div>
        )}

        {isCarousel && currentSlide > 0 && (
          <button onClick={prevSlide} className="absolute left-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-white/80 dark:bg-black/60 flex items-center justify-center shadow-sm text-[#262626] dark:text-white">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
        )}
        {isCarousel && currentSlide < media.length - 1 && (
          <button onClick={nextSlide} className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-white/80 dark:bg-black/60 flex items-center justify-center shadow-sm text-[#262626] dark:text-white">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18l6-6-6-6"/></svg>
          </button>
        )}
      </div>

      {/* Carousel dots */}
      {isCarousel && (
        <div className="flex justify-center gap-0.5 py-1.5">
          {media.map((_, i) => (
            <div key={i} data-carousel-dot className={`w-1 h-1 rounded-full ${i === currentSlide ? 'bg-[#0095f6]' : 'bg-[#c7c7c7] dark:bg-[#555]'}`} />
          ))}
        </div>
      )}

      {/* Action icons */}
      <div className={`px-2.5 ${isCarousel ? 'pt-0' : 'pt-1.5'} pb-0.5`}>
        <div className="flex items-center gap-2.5 text-[#262626] dark:text-[#f5f5f5]">
          <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
          <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
          <svg className="ml-auto" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
        </div>
      </div>

      {/* Caption */}
      <div className="px-2.5 py-1">
        <p className="text-[11px] text-[#262626] dark:text-[#f5f5f5] leading-[1.4]">
          <span className="font-semibold">{displayName}</span>{' '}
          {captionExpanded ? caption : truncatedCaption}
          {caption.length > 125 && !captionExpanded && (
            <button onClick={() => setCaptionExpanded(true)} className="text-[#737373] dark:text-[#a8a8a8] ml-0.5">mais</button>
          )}
        </p>
        <p className="text-[10px] text-[#737373] dark:text-[#a8a8a8] mt-1">Agendado: {formatDate(post.scheduled_at)}</p>
      </div>

      {/* Approval buttons */}
      {isPending && !result && (
        <div className="border-t border-[#efefef] dark:border-[#262626] px-2.5 py-2 space-y-1.5">
          <textarea
            value={comentario}
            onChange={e => setComentario(e.target.value)}
            placeholder="Comentário (opcional para aprovação)…"
            className="w-full rounded border border-stone-200 dark:border-[#333] px-2.5 py-1.5 text-[11px] resize-none min-h-[48px] bg-white dark:bg-[#0a0a0a] text-stone-900 dark:text-[#f5f5f5] placeholder:text-stone-400 dark:placeholder:text-[#666] focus:outline-none focus:border-stone-300 dark:focus:border-[#555] transition-all"
          />
          <div className="flex gap-1.5">
            <button
              onClick={() => handleAction('aprovado')}
              disabled={submitting}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded bg-emerald-500 text-white text-[11px] font-semibold hover:bg-emerald-600 disabled:opacity-50 transition-colors"
            >
              <CheckCircle size={12} /> Aprovar
            </button>
            <button
              onClick={() => handleAction('correcao')}
              disabled={submitting || !comentario.trim()}
              title={!comentario.trim() ? 'Deixe um comentário para solicitar correção' : undefined}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded border border-[#dbdbdb] dark:border-[#333] bg-white dark:bg-transparent text-[#262626] dark:text-[#f5f5f5] text-[11px] font-medium hover:bg-stone-50 dark:hover:bg-[#222] disabled:opacity-50 transition-colors"
            >
              <AlertCircle size={12} /> Correção
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className={`mx-2.5 mb-2 rounded-lg px-3 py-2 text-[11px] font-medium ${result.type === 'success' ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300' : 'bg-rose-50 dark:bg-rose-950/50 text-rose-800 dark:text-rose-300'}`}>
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
