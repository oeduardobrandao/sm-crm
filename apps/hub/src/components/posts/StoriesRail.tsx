import { useTranslation } from 'react-i18next';
import type { HubPost } from '../../types';
import { getPostCover, getPostPublishState, STATUS_COLORS } from '../../lib/postView';
import { MediaUnavailable } from '../MediaUnavailable';

interface StoriesRailProps {
  posts: HubPost[];
  onOpen: (postId: number) => void;
  /** Select mode: dim and disable (stories are not feed-selectable). */
  dimmed?: boolean;
}

export function StoriesRail({ posts, onOpen, dimmed }: StoriesRailProps) {
  const { t } = useTranslation('hubPosts');
  if (posts.length === 0) return null;
  return (
    <ul
      aria-label={t('posts.storiesRailLabel', 'Stories')}
      className={`flex gap-4 overflow-x-auto pb-2 mb-4 -mx-1 px-1 ${dimmed ? 'opacity-50' : ''}`}
    >
      {posts.map((post) => {
        const cover = getPostCover(post);
        const color = STATUS_COLORS[getPostPublishState(post)] ?? '#94a3b8';
        const src = cover?.kind === 'video' ? cover.thumbnail_url : cover?.url;
        return (
          <li key={post.id} className="shrink-0 w-[72px] flex flex-col items-center gap-1.5">
            <button
              type="button"
              disabled={dimmed}
              aria-label={t('posts.openStory', 'Ver story {{title}}', { title: post.titulo })}
              onClick={() => onOpen(post.id)}
              className="relative w-16 h-16 rounded-full p-[3px] bg-gradient-to-tr from-[#feda75] via-[#d62976] to-[#4f5bd5] hub-focus-accent focus:outline-none disabled:cursor-default"
            >
              <span className="block w-full h-full rounded-full overflow-hidden ring-2 ring-[var(--hub-card)] bg-[#111]">
                {cover?.media_lost_at || !src ? (
                  <MediaUnavailable size="compact" />
                ) : (
                  <img
                    src={src}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="w-full h-full object-cover"
                  />
                )}
              </span>
              <span
                className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full ring-2 ring-[var(--hub-card)]"
                style={{ background: color }}
                aria-hidden="true"
              />
            </button>
            <span className="text-[12px] hub-tx2 truncate w-full text-center">{post.titulo}</span>
          </li>
        );
      })}
    </ul>
  );
}
