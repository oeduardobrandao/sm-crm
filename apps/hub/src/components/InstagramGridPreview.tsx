import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle } from 'lucide-react';
import { reorderPostSchedules } from '../api';
import type { HubPost, InstagramFeedProfile, InstagramFeedPost } from '../types';

interface GridItem {
  type: 'pending' | 'live';
  id: string;
  postId: number | null;
  thumbnailUrl: string | null;
  videoUrl: string | null;
  mediaType: string;
  impressions: number;
  isCarousel: boolean;
  scheduledAt: string | null;
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

function formatShortDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', timeZone: 'UTC' });
}

interface InstagramGridPreviewProps {
  selectedPosts: HubPost[];
  feedProfile: InstagramFeedProfile;
  livePosts: InstagramFeedPost[];
  token: string;
  onClose: () => void;
  onScheduleUpdated?: () => void;
}

export function InstagramGridPreview({ selectedPosts, feedProfile, livePosts, token, onClose, onScheduleUpdated }: InstagramGridPreviewProps) {
  const [gridItems, setGridItems] = useState<GridItem[]>([]);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const touchRef = useRef<{ startX: number; startY: number; idx: number } | null>(null);
  const initialSchedulesRef = useRef<Map<number, string | null>>(new Map());

  useEffect(() => {
    const scheduleMap = new Map<number, string | null>();
    selectedPosts.forEach(p => scheduleMap.set(p.id, p.scheduled_at));
    initialSchedulesRef.current = scheduleMap;

    const sortedPosts = [...selectedPosts].sort((a, b) =>
      (b.scheduled_at ?? '').localeCompare(a.scheduled_at ?? '')
    );
    const pending: GridItem[] = sortedPosts.map(p => {
      const firstMedia = p.media?.[0];
      const isVideo = firstMedia?.kind === 'video';
      return {
        type: 'pending' as const,
        id: `pending-${p.id}`,
        postId: p.id,
        thumbnailUrl: isVideo ? (firstMedia.thumbnail_url ?? null) : (firstMedia?.url ?? null),
        videoUrl: isVideo ? firstMedia.url : null,
        mediaType: p.tipo === 'carrossel' || (p.media?.length ?? 0) > 1 ? 'CAROUSEL_ALBUM' : p.tipo === 'reels' ? 'VIDEO' : 'IMAGE',
        impressions: 0,
        isCarousel: (p.media?.length ?? 0) > 1,
        scheduledAt: p.scheduled_at,
      };
    });

    const live: GridItem[] = livePosts.map(p => ({
      type: 'live' as const,
      id: `live-${p.id}`,
      postId: null,
      thumbnailUrl: p.thumbnailUrl,
      videoUrl: null,
      mediaType: p.mediaType,
      impressions: p.impressions,
      isCarousel: p.mediaType === 'CAROUSEL_ALBUM',
      scheduledAt: null,
    }));

    setGridItems([...pending, ...live]);
    setHasChanges(false);
    setSaved(false);
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

  const reassignDates = useCallback((items: GridItem[]): GridItem[] => {
    const pendingItems = items.filter(i => i.type === 'pending');
    const dates = selectedPosts
      .map(p => p.scheduled_at)
      .sort((a, b) => (b ?? '').localeCompare(a ?? ''));

    let dateIdx = 0;
    return items.map(item => {
      if (item.type !== 'pending') return item;
      const newDate = dates[dateIdx] ?? null;
      dateIdx++;
      return { ...item, scheduledAt: newDate };
    });
  }, [selectedPosts]);

  const checkForChanges = useCallback((items: GridItem[]) => {
    const initial = initialSchedulesRef.current;
    const changed = items.some(item => {
      if (item.type !== 'pending' || item.postId === null) return false;
      return item.scheduledAt !== initial.get(item.postId);
    });
    setHasChanges(changed);
    setSaved(false);
  }, []);

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
      const reassigned = reassignDates(next);
      checkForChanges(reassigned);
      return reassigned;
    });
    setDragIdx(null);
    setDragOverIdx(null);
  }, [dragIdx, reassignDates, checkForChanges]);

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
          const reassigned = reassignDates(next);
          checkForChanges(reassigned);
          return reassigned;
        });
      }
    }
    touchRef.current = null;
    setDragIdx(null);
    setDragOverIdx(null);
  }, [reassignDates, checkForChanges]);

  async function handleSave() {
    const updates = gridItems
      .filter(i => i.type === 'pending' && i.postId !== null)
      .map(i => ({ post_id: i.postId!, scheduled_at: i.scheduledAt }));

    if (updates.length === 0) return;

    setSaving(true);
    try {
      await reorderPostSchedules(token, updates);
      initialSchedulesRef.current = new Map(
        gridItems.filter(i => i.type === 'pending' && i.postId !== null)
          .map(i => [i.postId!, i.scheduledAt])
      );
      setHasChanges(false);
      setSaved(true);
      onScheduleUpdated?.();
    } catch {
      // keep hasChanges true so user can retry
    } finally {
      setSaving(false);
    }
  }

  const displayName = feedProfile.username ?? '';

  const eyeIcon = (
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" stroke="white" strokeWidth="1.8"/>
      <circle cx="12" cy="12" r="3" stroke="white" strokeWidth="1.8"/>
    </svg>
  );

  const carouselIcon = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="white" style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.5))' }}>
      <path d="M4 6.5C4 5.12 5.12 4 6.5 4h8C15.88 4 17 5.12 17 6.5v8c0 1.38-1.12 2.5-2.5 2.5h-8C5.12 17 4 15.88 4 14.5v-8zm2.5-.5a.5.5 0 00-.5.5v8a.5.5 0 00.5.5h8a.5.5 0 00.5-.5v-8a.5.5 0 00-.5-.5h-8zM19 7.5v10c0 1.38-1.12 2.5-2.5 2.5h-10c-.55 0-1 .45-1 1s.45 1 1 1h10c2.49 0 4.5-2.01 4.5-4.5v-10c0-.55-.45-1-1-1s-1 .45-1 1z"/>
    </svg>
  );

  const reelsIcon = (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="white" style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.5))' }}>
      <path d="M3 5.5C3 4.12 4.12 3 5.5 3h13C19.88 3 21 4.12 21 5.5v13c0 1.38-1.12 2.5-2.5 2.5h-13C4.12 21 3 19.88 3 18.5v-13zM5.5 5a.5.5 0 00-.5.5v13a.5.5 0 00.5.5h13a.5.5 0 00.5-.5v-13a.5.5 0 00-.5-.5h-13zM10 8.5v7a.5.5 0 00.77.42l5.5-3.5a.5.5 0 000-.84l-5.5-3.5A.5.5 0 0010 8.5z"/>
    </svg>
  );

  return createPortal(
    <div className="fixed inset-0 z-[9010] bg-black/70 backdrop-blur-sm flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-white rounded-2xl w-[420px] max-h-[92vh] flex flex-col relative"
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

        <div className="overflow-y-auto flex-1 min-h-0">
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
        <div className="flex items-center justify-center gap-1.5 py-2 bg-stone-50 text-stone-500 text-[11px] font-medium">
          <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3"/>
          </svg>
          Arraste os posts para reordenar — as datas de publicação serão ajustadas
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
              ) : item.videoUrl ? (
                <video src={item.videoUrl} muted preload="metadata" className="w-full h-full object-cover" />
              ) : (
                <div data-grid-placeholder className="w-full h-full bg-[#efefef]" />
              )}

              {item.type === 'pending' && (
                <span className="absolute top-1.5 left-1.5 bg-[#0095f6] text-white text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide">
                  {formatShortDate(item.scheduledAt)}
                </span>
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
        </div>{/* end scrollable */}

        {/* Sticky footer */}
        {(hasChanges || saved) && (
          <div className="shrink-0 border-t border-[#efefef] px-4 py-3">
            {hasChanges && (
              <button
                onClick={handleSave}
                disabled={saving}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-stone-900 text-white text-[13px] font-semibold hover:bg-stone-800 disabled:opacity-50 transition-colors"
              >
                {saving ? (
                  <div className="animate-spin h-4 w-4 rounded-full border-2 border-white/30 border-t-white" />
                ) : (
                  <>
                    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M20 6L9 17l-5-5"/></svg>
                    Salvar agendamento
                  </>
                )}
              </button>
            )}
            {saved && !hasChanges && (
              <div className="flex items-center justify-center gap-1.5 text-[12px] text-emerald-600 font-medium">
                <CheckCircle size={14} />
                Agendamento atualizado
              </div>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
