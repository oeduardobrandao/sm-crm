import { Link } from 'react-router-dom';
import { PlayCircle } from 'lucide-react';
import { formatDuration, type VideoSearchHit } from './playlist';

export function VideoResultCard({ hit }: { hit: VideoSearchHit }) {
  const { video, seriesTitle } = hit;
  return (
    <Link
      to={`/ajuda/video/${video.slug}`}
      className="group block overflow-hidden rounded-2xl border border-[var(--border-color)] bg-[var(--card-bg)] transition-all hover:-translate-y-0.5 hover:shadow-lg"
    >
      <div className="relative aspect-video w-full overflow-hidden bg-[var(--surface-darker)]">
        {video.thumbnail_url ? (
          <img
            src={video.thumbnail_url}
            alt=""
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <PlayCircle className="h-10 w-10 text-[var(--text-light)] opacity-40" />
          </div>
        )}
        {video.duration_seconds != null && (
          <span className="absolute bottom-2 right-2 rounded bg-black/75 px-1.5 py-0.5 text-[0.7rem] font-medium tabular-nums text-white">
            {formatDuration(video.duration_seconds)}
          </span>
        )}
      </div>
      <div className="p-5">
        <span className="mb-2 inline-block rounded-sm bg-[rgba(234,179,8,0.1)] px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-[var(--primary-color)]">
          Vídeo · {seriesTitle}
        </span>
        <h3 className="line-clamp-2 text-[1.05rem] font-bold leading-snug text-[var(--text-main)] font-[var(--font-heading)]">
          {video.title}
        </h3>
      </div>
    </Link>
  );
}
