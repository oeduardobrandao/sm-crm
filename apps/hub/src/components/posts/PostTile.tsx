import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Images, Play, Circle, ImageOff, ExternalLink } from 'lucide-react';
import type { HubPost } from '../../types';
import { getPostCover, getPostPublishState, getTipoLabel } from '../../lib/postView';
import { formatDate } from '../PostCard';
import { OptimizedImage } from '../OptimizedImage';
import { MediaUnavailable } from '../MediaUnavailable';
import { sanitizeExternalUrl } from '../../lib/security';
import { StatusTag } from './StatusTag';

export type TileMode = 'browse' | 'select';

interface PostTileProps {
  post: HubPost;
  mode: TileMode;
  selected: boolean;
  onOpen: (postId: number) => void;
  onToggle: (postId: number) => void;
  /** Eager-load the image (first row). */
  priority?: boolean;
}

export function isFeedSelectable(post: HubPost): boolean {
  return (post.media?.length ?? 0) > 0 && post.tipo !== 'stories';
}

function typeGlyph(post: HubPost): ReactNode {
  if (post.tipo === 'carrossel' || (post.media?.length ?? 0) > 1)
    return <Images size={13} aria-hidden="true" />;
  if (post.tipo === 'reels' || post.media?.[0]?.kind === 'video')
    return <Play size={13} aria-hidden="true" />;
  if (post.tipo === 'stories') return <Circle size={13} aria-hidden="true" />;
  return null;
}

export function PostTile({ post, mode, selected, onOpen, onToggle, priority }: PostTileProps) {
  const { t, i18n } = useTranslation('hubPosts');
  const dateLang = i18n.language === 'en' ? 'en-US' : 'pt-BR';
  const cover = getPostCover(post);
  const selectable = isFeedSelectable(post);
  const selecting = mode === 'select';
  const inert = selecting && !selectable;
  const status = getPostPublishState(post);
  const openLabel = t('posts.openTile', 'Abrir {{title}}', { title: post.titulo });

  const autocleanedLink = post.media_autocleaned_at
    ? post.instagram_permalink
      ? { href: post.instagram_permalink, label: t('shared.viewOnInstagram', 'Ver no Instagram') }
      : post.tiktok_post_url
        ? { href: post.tiktok_post_url, label: t('shared.viewOnTikTok', 'Ver no TikTok') }
        : null
    : null;

  const glyph = typeGlyph(post);

  const overlays = (
    <>
      <span className="absolute top-2 left-2 z-10">
        <StatusTag status={status} />
      </span>
      {glyph && (
        <span className="absolute top-2 right-2 z-10 w-6 h-6 rounded-md bg-black/45 text-white flex items-center justify-center">
          {glyph}
        </span>
      )}
    </>
  );

  let body: ReactNode;
  if (cover) {
    body = (
      <>
        {cover.media_lost_at ? (
          <MediaUnavailable size="full" />
        ) : cover.kind === 'image' ? (
          cover.url ? (
            <OptimizedImage
              src={cover.url}
              alt=""
              role="img"
              aria-hidden="true"
              width={cover.width ?? undefined}
              height={cover.height ?? undefined}
              blurDataURL={cover.blur_data_url ?? undefined}
              sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
              priority={priority}
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <MediaUnavailable size="full" />
          )
        ) : cover.thumbnail_url ? (
          <img
            src={cover.thumbnail_url}
            alt=""
            role="img"
            aria-hidden="true"
            loading={priority ? 'eager' : 'lazy'}
            decoding="async"
            draggable={false}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <MediaUnavailable size="full" />
        )}
        {overlays}
        <span className="absolute inset-x-0 bottom-0 z-10 px-2.5 pt-8 pb-2 bg-gradient-to-t from-black/65 to-transparent text-white text-[12px] font-medium truncate">
          {post.titulo}
        </span>
      </>
    );
  } else if (post.media_autocleaned_at) {
    body = (
      <div className="absolute inset-0 hub-bg-soft flex flex-col items-center justify-center gap-2 px-3 text-center">
        {overlays}
        <ImageOff size={22} className="hub-tx3 opacity-60" aria-hidden="true" />
        <span className="text-[12px] font-medium hub-tx2">
          {t('posts.mediaRemoved', 'Mídia removida')}
        </span>
        <span className="text-[12px] hub-txt font-display line-clamp-2">{post.titulo}</span>
      </div>
    );
  } else {
    body = (
      <div className="absolute inset-0 hub-card flex flex-col gap-1.5 p-3 text-left">
        <span className="self-start">
          <StatusTag status={status} />
        </span>
        <span className="font-display text-[15px] leading-[1.2] hub-txt line-clamp-2 mt-1">
          {post.titulo}
        </span>
        <span className="text-[12px] leading-[1.4] hub-tx2 line-clamp-4">
          {post.ig_caption || post.conteudo_plain}
        </span>
        <span className="mt-auto text-[11px] hub-tx3">
          {getTipoLabel(t, post.tipo)} · {formatDate(post.scheduled_at, dateLang)}
        </span>
      </div>
    );
  }

  const base = 'relative w-full aspect-[4/5]';

  if (selecting && selectable) {
    return (
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-label={t('instagramCard.selectAriaLabel', 'Selecionar publicação')}
        onClick={() => onToggle(post.id)}
        className={`${base} block rounded-xl overflow-hidden text-left transition-[transform,box-shadow,opacity] hub-focus-accent focus:outline-none ${selected ? 'ring-[3px] ring-[#0095f6]' : 'ring-1 ring-black/5'}`}
      >
        {body}
        <span
          className={`absolute bottom-2 right-2 z-20 w-7 h-7 rounded-full flex items-center justify-center shadow-md ${selected ? 'bg-[#0095f6]' : 'bg-black/35 border-2 border-white'}`}
        >
          <svg
            width="14"
            height="14"
            fill="none"
            stroke="#fff"
            strokeWidth="2.5"
            viewBox="0 0 24 24"
          >
            <path d="M5 13l4 4L19 7" />
          </svg>
        </span>
      </button>
    );
  }

  return (
    <div className={base}>
      <button
        type="button"
        aria-label={openLabel}
        disabled={inert}
        onClick={() => onOpen(post.id)}
        className={`absolute inset-0 rounded-xl overflow-hidden text-left transition-[transform,box-shadow,opacity] hub-focus-accent focus:outline-none ring-1 ring-black/5 ${inert ? 'opacity-50 cursor-default' : 'hover:-translate-y-0.5 hover:shadow-lg'}`}
      >
        {body}
      </button>
      {autocleanedLink && !cover && (
        <a
          href={sanitizeExternalUrl(autocleanedLink.href)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="absolute z-20 bottom-2 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 text-[11px] font-semibold"
          style={{ color: 'var(--hub-acc)' }}
        >
          {autocleanedLink.label}
          <ExternalLink size={10} aria-hidden="true" />
        </a>
      )}
    </div>
  );
}
