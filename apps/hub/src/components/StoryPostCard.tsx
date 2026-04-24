import { useState } from 'react';
import { CheckCircle, AlertCircle } from 'lucide-react';
import { submitApproval } from '../api';
import { formatDate } from './PostCard';
import { PostMediaLightbox } from './PostMediaLightbox';
import type { HubPost, PostApproval, InstagramProfile } from '../types';

interface StoryPostCardProps {
  post: HubPost;
  token: string;
  approvals: PostApproval[];
  instagramProfile: InstagramProfile | null;
  workspaceName?: string;
  onApprovalSubmitted: () => void;
}

export function StoryPostCard({
  post, token, approvals, instagramProfile, workspaceName,
  onApprovalSubmitted,
}: StoryPostCardProps) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const [comentario, setComentario] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  const isPending = post.status === 'enviado_cliente';
  const media = post.media ?? [];
  const displayName = instagramProfile?.username ?? workspaceName ?? '';
  const profilePic = instagramProfile?.profilePictureUrl;
  const rawText = post.conteudo_plain ?? '';
  const legendaIdx = rawText.toUpperCase().indexOf('LEGENDA');
  const caption = legendaIdx !== -1
    ? rawText.slice(legendaIdx + 'LEGENDA'.length).replace(/^[:\s\n]+/, '').trim()
    : rawText;

  const currentMedia = media[currentSlide];

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

  function handleTapLeft() {
    if (currentSlide > 0) setCurrentSlide(i => i - 1);
  }

  function handleTapRight() {
    if (currentSlide < media.length - 1) setCurrentSlide(i => i + 1);
    else setLightboxIdx(currentSlide);
  }

  return (
    <div
      className="relative rounded-2xl overflow-hidden"
      style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' }}
    >
      {/* Story frame */}
      <div className="relative bg-[#1a1a1a] rounded-2xl overflow-hidden" style={{ aspectRatio: '9/16' }}>
        {/* Image */}
        {currentMedia && (
          <button type="button" onClick={() => setLightboxIdx(currentSlide)} className="absolute inset-0 w-full h-full z-0">
            {currentMedia.kind === 'image' ? (
              <img src={currentMedia.url} alt="" className="w-full h-full object-cover" />
            ) : (
              <img src={currentMedia.thumbnail_url ?? ''} alt="" className="w-full h-full object-cover" />
            )}
          </button>
        )}

        {currentMedia?.kind === 'video' && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <div className="w-14 h-14 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
            </div>
          </div>
        )}

        {/* Tap zones for multi-media stories */}
        {media.length > 1 && (
          <>
            <button onClick={handleTapLeft} className="absolute left-0 top-0 w-1/3 h-full z-10" aria-label="Anterior" />
            <button onClick={handleTapRight} className="absolute right-0 top-0 w-1/3 h-full z-10" aria-label="Próximo" />
          </>
        )}

        {/* Top gradient for readability */}
        <div className="absolute top-0 left-0 right-0 h-24 bg-gradient-to-b from-black/40 to-transparent z-10 pointer-events-none" />

        {/* Progress bar segments */}
        <div className="absolute top-2 left-2 right-2 z-20 flex gap-[3px]">
          {media.length > 0 ? media.map((_, i) => (
            <div key={i} className="flex-1 h-[2px] rounded-full bg-white/30 overflow-hidden">
              <div className={`h-full rounded-full bg-white ${i < currentSlide ? 'w-full' : i === currentSlide ? 'w-full' : 'w-0'}`} />
            </div>
          )) : (
            <div className="flex-1 h-[2px] rounded-full bg-white/30 overflow-hidden">
              <div className="h-full rounded-full bg-white w-full" />
            </div>
          )}
        </div>

        {/* Profile header */}
        <div className="absolute top-5 left-0 right-0 z-20 flex items-center px-3 gap-2">
          {profilePic ? (
            <img src={profilePic} alt={displayName} className="w-8 h-8 rounded-full object-cover ring-2 ring-white/40" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-stone-600 flex items-center justify-center text-[11px] font-bold text-white ring-2 ring-white/40">
              {displayName.charAt(0).toUpperCase()}
            </div>
          )}
          <span className="text-white text-[13px] font-semibold drop-shadow-sm">{displayName}</span>
          <span className="text-white/60 text-[12px] drop-shadow-sm">{formatDate(post.scheduled_at)}</span>

          <div className="ml-auto flex items-center gap-3">
            {/* Play icon */}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="white" className="opacity-80">
              <path d="M8 5v14l11-7z"/>
            </svg>
            {/* More menu */}
            <svg width="16" height="16" viewBox="0 0 24 24" fill="white" className="opacity-80">
              <circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
            </svg>
          </div>
        </div>

        {/* Bottom gradient for readability */}
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-black/50 to-transparent z-10 pointer-events-none" />

        {/* Caption overlay */}
        {caption && (
          <div className="absolute bottom-14 left-3 right-3 z-20">
            <p className="text-white text-[13px] leading-[1.4] bg-black/50 backdrop-blur-sm rounded-2xl px-4 py-2.5 break-words">
              {caption.length > 200 ? caption.slice(0, 200) + '...' : caption}
            </p>
          </div>
        )}

        {/* Bottom bar - Reply + heart + send */}
        <div className="absolute bottom-2.5 left-2.5 right-2.5 z-20 flex items-center gap-2.5">
          <div className="flex-1 border border-white/30 rounded-full px-4 py-1.5 text-white/50 text-[13px] truncate">
            Responder para {displayName}...
          </div>
          {/* Heart */}
          <svg width="22" height="22" fill="none" stroke="white" strokeWidth="1.5" viewBox="0 0 24 24" className="opacity-90 shrink-0">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
          </svg>
          {/* Send */}
          <svg width="22" height="22" fill="none" stroke="white" strokeWidth="1.5" viewBox="0 0 24 24" className="opacity-90 shrink-0">
            <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
          </svg>
        </div>
      </div>

      {/* Approval section */}
      {isPending && !result && (
        <div className="bg-white dark:bg-[#1a1a1a] border border-[#dbdbdb] dark:border-[#262626] border-t-0 rounded-b-2xl px-3 py-2.5 space-y-1.5 -mt-2 pt-4">
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
        <div className={`bg-white dark:bg-[#1a1a1a] border border-[#dbdbdb] dark:border-[#262626] border-t-0 rounded-b-2xl px-3 py-2.5 -mt-2 pt-4`}>
          <div className={`rounded-lg px-3 py-2 text-[11px] font-medium ${result.type === 'success' ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300' : 'bg-rose-50 dark:bg-rose-950/50 text-rose-800 dark:text-rose-300'}`}>
            {result.message}
          </div>
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
