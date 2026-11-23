import type { PostAnalytics } from '../../../services/analytics';
import { sanitizeUrl } from '../../../utils/security';
import { mediaAccentColor } from '../contaFormat';

export function PostThumbnail({
  post,
  size,
}: {
  post: Pick<PostAnalytics, 'thumbnail_url' | 'media_type'>;
  size: 'card' | 'list' | 'metrics';
}) {
  const accent = mediaAccentColor(post.media_type);
  // 'card' and 'metrics' both fill the parent box; only 'list' is a fixed square.
  const dimensions =
    size === 'list' ? { width: 52, height: 52 } : { width: '100%', height: '100%' };

  if (post.thumbnail_url) {
    return (
      <img
        src={sanitizeUrl(post.thumbnail_url)}
        alt=""
        style={{
          ...dimensions,
          objectFit: 'cover',
          flexShrink: 0,
          background: 'var(--surface-darker)',
        }}
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = 'none';
        }}
      />
    );
  }

  return (
    <div
      style={{
        ...dimensions,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: `linear-gradient(135deg, ${accent}, ${accent}cc)`,
      }}
    >
      <span
        style={{ width: 42, height: 42, borderRadius: 8, background: 'rgba(255,255,255,0.18)' }}
      />
    </div>
  );
}
