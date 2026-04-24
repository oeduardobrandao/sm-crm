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
  isSelected: boolean;
  onToggleSelect: (postId: number) => void;
  onApprovalSubmitted: () => void;
}

export function InstagramPostCard({
  post, token, approvals, instagramProfile, workspaceName,
  isSelected, onToggleSelect, onApprovalSubmitted,
}: InstagramPostCardProps) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [captionExpanded, setCaptionExpanded] = useState(false);
  const [comentario, setComentario] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  const isPending = post.status === 'enviado_cliente';
  const media = post.media ?? [];
  const isCarousel = media.length > 1;
  const displayName = instagramProfile?.username ?? workspaceName ?? '';
  const profilePic = instagramProfile?.profilePictureUrl;
  const caption = post.conteudo_plain ?? '';
  const truncatedCaption = caption.length > 125 ? caption.slice(0, 125) + '...' : caption;

  async function handleAction(action: 'aprovado' | 'correcao') {
    setSubmitting(true);
    setResult(null);
    try {
      await submitApproval(token, post.id, action, comentario || undefined);
      setResult({ type: 'success', message: action === 'aprovado' ? 'Post aprovado!' : 'Correção enviada!' });
      onApprovalSubmitted();
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
      className={`relative bg-white rounded-xl overflow-hidden border-[1.5px] transition-all ${isSelected ? 'border-[#0095f6] shadow-[0_0_0_2px_rgba(0,149,246,0.2)]' : 'border-[#dbdbdb]'}`}
      style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' }}
    >
      {/* Selection checkbox */}
      <div className="absolute top-3 right-3 z-10">
        <button
          type="button"
          role="checkbox"
          aria-checked={isSelected}
          onClick={(e) => { e.stopPropagation(); onToggleSelect(post.id); }}
          className={`w-[22px] h-[22px] rounded-full flex items-center justify-center cursor-pointer shadow-md ${isSelected ? 'bg-[#0095f6]' : 'bg-black/30 border-2 border-white'}`}
        >
          <svg width="12" height="12" fill="none" stroke="#fff" strokeWidth="2.5" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>
        </button>
      </div>

      {/* Profile header */}
      <div className="flex items-center px-3.5 py-2.5 gap-2.5 relative">
        {profilePic ? (
          <img src={profilePic} alt={displayName} className="w-8 h-8 rounded-full object-cover" />
        ) : (
          <div className="w-8 h-8 rounded-full bg-stone-200 flex items-center justify-center text-[11px] font-bold text-stone-500">
            {displayName.charAt(0).toUpperCase()}
          </div>
        )}
        <span className="text-[13px] font-semibold text-[#262626]">{displayName}</span>
        <span className="ml-auto text-[#262626] text-base">•••</span>
      </div>

      {/* Image area */}
      <div className="relative aspect-[4/5] bg-stone-100">
        {currentMedia && (
          <button type="button" onClick={() => setLightboxIdx(currentSlide)} className="w-full h-full">
            {currentMedia.kind === 'image' ? (
              <img src={currentMedia.url} alt="" className="w-full h-full object-cover" />
            ) : (
              <img src={currentMedia.thumbnail_url ?? ''} alt="" className="w-full h-full object-cover" />
            )}
          </button>
        )}

        {isCarousel && currentSlide > 0 && (
          <button onClick={prevSlide} className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-white/80 flex items-center justify-center shadow-sm text-[#262626]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
        )}
        {isCarousel && currentSlide < media.length - 1 && (
          <button onClick={nextSlide} className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-white/80 flex items-center justify-center shadow-sm text-[#262626]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M9 18l6-6-6-6"/></svg>
          </button>
        )}
      </div>

      {/* Carousel dots */}
      {isCarousel && (
        <div className="flex justify-center gap-1 py-2">
          {media.map((_, i) => (
            <div key={i} data-carousel-dot className={`w-1.5 h-1.5 rounded-full ${i === currentSlide ? 'bg-[#0095f6]' : 'bg-[#c7c7c7]'}`} />
          ))}
        </div>
      )}

      {/* Action icons */}
      <div className={`px-3.5 ${isCarousel ? 'pt-0' : 'pt-2.5'} pb-1`}>
        <div className="flex items-center gap-3.5">
          <svg width="24" height="24" fill="none" stroke="#262626" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
          <svg width="24" height="24" fill="none" stroke="#262626" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          <svg width="24" height="24" fill="none" stroke="#262626" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
          <svg className="ml-auto" width="24" height="24" fill="none" stroke="#262626" strokeWidth="1.8" viewBox="0 0 24 24"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
        </div>
      </div>

      {/* Caption */}
      <div className="px-3.5 py-1.5">
        {caption && (
          <p className="text-[13px] text-[#262626] leading-[1.4]">
            {captionExpanded ? caption : truncatedCaption}
            {caption.length > 125 && !captionExpanded && (
              <button onClick={() => setCaptionExpanded(true)} className="text-[#737373] ml-1">mais</button>
            )}
          </p>
        )}
        <p className="text-[11px] text-[#737373] mt-1.5">Agendado: {formatDate(post.scheduled_at)}</p>
      </div>

      {/* Approval buttons */}
      {isPending && !result && (
        <div className="border-t border-[#efefef] px-3.5 py-2.5 space-y-2">
          <textarea
            value={comentario}
            onChange={e => setComentario(e.target.value)}
            placeholder="Comentário (opcional)…"
            className="w-full rounded-lg border border-stone-200 px-3 py-2 text-[12px] resize-none min-h-[60px] bg-white text-stone-900 placeholder:text-stone-400 focus:outline-none focus:border-stone-300 transition-all"
          />
          <div className="flex gap-2">
            <button
              onClick={() => handleAction('aprovado')}
              disabled={submitting}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-emerald-500 text-white text-[13px] font-semibold hover:bg-emerald-600 disabled:opacity-50 transition-colors"
            >
              <CheckCircle size={14} /> Aprovar
            </button>
            <button
              onClick={() => handleAction('correcao')}
              disabled={submitting}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-[#dbdbdb] bg-white text-[#262626] text-[13px] font-medium hover:bg-stone-50 disabled:opacity-50 transition-colors"
            >
              <AlertCircle size={14} /> Solicitar correção
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className={`mx-3.5 mb-3 rounded-lg px-4 py-3 text-[13px] font-medium ${result.type === 'success' ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>
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
