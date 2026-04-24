import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { HubPost, InstagramFeedProfile, InstagramFeedPost } from '../types';

interface GridItem {
  type: 'pending' | 'live';
  id: string;
  thumbnailUrl: string | null;
  mediaType: string;
  impressions: number;
  isCarousel: boolean;
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 10_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
  if (n >= 1_000) return n.toLocaleString('pt-BR');
  return String(n);
}

function formatImpressions(n: number): string {
  return n.toLocaleString('pt-BR');
}

interface InstagramGridPreviewProps {
  selectedPosts: HubPost[];
  feedProfile: InstagramFeedProfile;
  livePosts: InstagramFeedPost[];
  onClose: () => void;
}

export function InstagramGridPreview({ selectedPosts, feedProfile, livePosts, onClose }: InstagramGridPreviewProps) {
  const [gridItems, setGridItems] = useState<GridItem[]>([]);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const touchRef = useRef<{ startX: number; startY: number; idx: number } | null>(null);

  useEffect(() => {
    const pending: GridItem[] = selectedPosts.map(p => ({
      type: 'pending' as const,
      id: `pending-${p.id}`,
      thumbnailUrl: p.cover_media?.url ?? p.media?.[0]?.url ?? null,
      mediaType: p.tipo === 'carrossel' || (p.media?.length ?? 0) > 1 ? 'CAROUSEL_ALBUM' : p.tipo === 'reels' ? 'VIDEO' : 'IMAGE',
      impressions: 0,
      isCarousel: (p.media?.length ?? 0) > 1,
    }));

    const live: GridItem[] = livePosts.map(p => ({
      type: 'live' as const,
      id: `live-${p.id}`,
      thumbnailUrl: p.thumbnailUrl,
      mediaType: p.mediaType,
      impressions: p.impressions,
      isCarousel: p.mediaType === 'CAROUSEL_ALBUM',
    }));

    setGridItems([...pending, ...live]);
  }, [selectedPosts, livePosts]);

  useEffect(() => {
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleEscape);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const handleDragStart = useCallback((idx: number) => {
    if (gridItems[idx].type !== 'pending') return;
    setDragIdx(idx);
  }, [gridItems]);

  const handleDragOver = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDragOverIdx(idx);
  }, []);

  const handleDrop = useCallback((targetIdx: number) => {
    if (dragIdx === null || dragIdx === targetIdx) {
      setDragIdx(null);
      setDragOverIdx(null);
      return;
    }
    setGridItems(prev => {
      const next = [...prev];
      const [moved] = next.splice(dragIdx, 1);
      next.splice(targetIdx, 0, moved);
      return next;
    });
    setDragIdx(null);
    setDragOverIdx(null);
  }, [dragIdx]);

  const handleTouchStart = useCallback((e: React.TouchEvent, idx: number) => {
    if (gridItems[idx].type !== 'pending') return;
    const touch = e.touches[0];
    touchRef.current = { startX: touch.clientX, startY: touch.clientY, idx };
  }, [gridItems]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!touchRef.current) return;
    const touch = e.changedTouches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const gridCell = el?.closest('[data-grid-idx]');
    if (gridCell) {
      const targetIdx = parseInt(gridCell.getAttribute('data-grid-idx')!, 10);
      const sourceIdx = touchRef.current.idx;
      if (sourceIdx !== targetIdx) {
        setGridItems(prev => {
          const next = [...prev];
          const [moved] = next.splice(sourceIdx, 1);
          next.splice(targetIdx, 0, moved);
          return next;
        });
      }
    }
    touchRef.current = null;
    setDragIdx(null);
    setDragOverIdx(null);
  }, []);

  const displayName = feedProfile.username ?? '';

  const eyeIcon = (
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" stroke="white" strokeWidth="1.8"/>
      <circle cx="12" cy="12" r="3" stroke="white" strokeWidth="1.8"/>
    </svg>
  );

  const carouselIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect x="2" y="4" width="14" height="14" rx="2.5" stroke="white" strokeWidth="2" fill="rgba(0,0,0,0.15)"/>
      <rect x="8" y="6" width="14" height="14" rx="2.5" stroke="white" strokeWidth="2" fill="rgba(0,0,0,0.15)"/>
    </svg>
  );

  const reelsIcon = (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="18" height="18" rx="3" stroke="white" strokeWidth="1.8" fill="rgba(0,0,0,0.15)"/>
      <path d="M10 8.5v7l5.5-3.5L10 8.5z" fill="white"/>
    </svg>
  );

  return createPortal(
    <div className="fixed inset-0 z-[9010] bg-black/70 backdrop-blur-sm flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-white rounded-2xl w-[420px] max-h-[92vh] overflow-y-auto relative"
        style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          aria-label="Fechar"
          className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-black/5 hover:bg-black/10 flex items-center justify-center text-[#262626] text-base transition-colors"
        >
          ✕
        </button>

        {/* Top bar */}
        <div className="flex items-center justify-center pt-4 pb-2">
          <span className="text-[20px] font-bold text-[#262626] flex items-center gap-1">
            {displayName}
            <svg width="16" height="16" fill="#262626" viewBox="0 0 24 24"><path d="M7 10l5 5 5-5z"/></svg>
          </span>
        </div>

        {/* Profile header */}
        <div className="flex items-start gap-5 px-5 py-3">
          <div className="shrink-0 relative">
            {feedProfile.profilePictureUrl ? (
              <img src={feedProfile.profilePictureUrl} alt={displayName} className="w-[86px] h-[86px] rounded-full object-cover" />
            ) : (
              <div className="w-[86px] h-[86px] rounded-full bg-stone-200 flex items-center justify-center text-2xl font-bold text-stone-500">
                {displayName.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="absolute bottom-0 right-0 w-6 h-6 rounded-full bg-[#0095f6] border-[2.5px] border-white flex items-center justify-center">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="white" strokeWidth="2.5" strokeLinecap="round"/></svg>
            </div>
          </div>
          <div className="flex-1 pt-2">
            <div className="flex justify-between">
              <div className="text-center">
                <span className="block text-base font-bold text-[#262626]">{formatCount(feedProfile.mediaCount)}</span>
                <span className="text-[13px] text-[#262626]">posts</span>
              </div>
              <div className="text-center">
                <span className="block text-base font-bold text-[#262626]">{formatCount(feedProfile.followerCount)}</span>
                <span className="text-[13px] text-[#262626]">seguidores</span>
              </div>
              <div className="text-center">
                <span className="block text-base font-bold text-[#262626]">{formatCount(feedProfile.followingCount)}</span>
                <span className="text-[13px] text-[#262626]">seguindo</span>
              </div>
            </div>
          </div>
        </div>

        {/* Action buttons (decorative) */}
        <div className="flex gap-1.5 px-4 pb-3">
          <div className="flex-1 py-[7px] rounded-lg bg-[#efefef] text-center text-[13px] font-semibold text-[#262626]">Seguir</div>
          <div className="flex-1 py-[7px] rounded-lg bg-[#efefef] text-center text-[13px] font-semibold text-[#262626]">Mensagem</div>
          <div className="flex-1 py-[7px] rounded-lg bg-[#efefef] text-center text-[13px] font-semibold text-[#262626]">Contato</div>
        </div>

        {/* Tab bar */}
        <div className="flex border-t border-[#dbdbdb]">
          <div className="flex-1 py-2.5 flex justify-center border-t border-[#262626] -mt-px">
            <svg width="24" height="24" fill="none" viewBox="0 0 24 24">
              <rect x="3" y="3" width="7.5" height="7.5" rx="1" fill="#262626"/>
              <rect x="13.5" y="3" width="7.5" height="7.5" rx="1" fill="#262626"/>
              <rect x="3" y="13.5" width="7.5" height="7.5" rx="1" fill="#262626"/>
              <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1" fill="#262626"/>
            </svg>
          </div>
          <div className="flex-1 py-2.5 flex justify-center text-[#8e8e8e]">
            <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <rect x="3" y="3" width="18" height="18" rx="3"/>
              <path d="M9.5 15.5V8.5l7 3.5-7 3.5z" fill="currentColor" stroke="none"/>
            </svg>
          </div>
          <div className="flex-1 py-2.5 flex justify-center text-[#8e8e8e]">
            <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/>
              <path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>
            </svg>
          </div>
          <div className="flex-1 py-2.5 flex justify-center text-[#8e8e8e]">
            <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <rect x="3" y="3" width="18" height="18" rx="3"/>
              <circle cx="12" cy="10" r="3"/><path d="M6 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/>
            </svg>
          </div>
        </div>

        {/* Drag hint */}
        <div className="flex items-center justify-center gap-1.5 py-2 bg-[#f0f7ff] text-[#0095f6] text-[11px] font-medium">
          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3"/>
          </svg>
          Arraste os posts novos para reordenar
        </div>

        {/* Grid */}
        <div className="grid grid-cols-3 gap-[1.5px]">
          {gridItems.map((item, idx) => (
            <div
              key={item.id}
              data-grid-idx={idx}
              draggable={item.type === 'pending'}
              onDragStart={() => handleDragStart(idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDrop={() => handleDrop(idx)}
              onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
              onTouchStart={(e) => handleTouchStart(e, idx)}
              onTouchEnd={handleTouchEnd}
              className={`aspect-[4/5] relative overflow-hidden bg-[#efefef] ${
                item.type === 'pending' ? 'cursor-grab active:cursor-grabbing shadow-[inset_0_0_0_2.5px_#0095f6]' : ''
              } ${dragIdx === idx ? 'opacity-50 scale-95' : ''} ${dragOverIdx === idx && dragIdx !== idx ? 'outline outline-2 outline-[#0095f6] -outline-offset-2' : ''}`}
            >
              {item.thumbnailUrl ? (
                <img src={item.thumbnailUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <div data-grid-placeholder className="w-full h-full bg-[#efefef]" />
              )}

              {item.type === 'pending' && (
                <span className="absolute top-1.5 left-1.5 bg-[#0095f6] text-white text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide">Novo</span>
              )}

              {item.isCarousel && (
                <span className="absolute top-1.5 right-1.5 drop-shadow-md">{carouselIcon}</span>
              )}
              {item.mediaType === 'VIDEO' && !item.isCarousel && (
                <span className="absolute top-1.5 right-1.5 drop-shadow-md">{reelsIcon}</span>
              )}

              <div className="absolute bottom-1.5 left-2 flex items-center gap-1 text-white text-[12px] font-semibold" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.5)' }}>
                {eyeIcon}
                {item.type === 'pending' ? '—' : formatImpressions(item.impressions)}
              </div>
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="flex gap-4 justify-center py-3 text-[11px] text-[#8e8e8e]">
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-sm bg-[#0095f6]" />
            Posts para aprovar
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-sm bg-[#dbdbdb]" />
            Posts publicados
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
