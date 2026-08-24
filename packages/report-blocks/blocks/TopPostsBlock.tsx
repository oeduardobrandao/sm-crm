import type { BlockProps } from '../BlockRenderer';
import type { SnapshotTopPost } from '../types';
import { fmtCount } from '../format';

const TYPE_LABELS: Record<SnapshotTopPost['type'], string> = {
  reel: 'Reel',
  carousel: 'Carrossel',
  image: 'Imagem',
};
const DEFAULT_COUNT = 6;

// Contagem PAR em bloco de largura cheia: linhas equilibradas (6 -> 2x3,
// 8 -> 2x4, 12 -> 3x4). Preferência de divisor 4, 3, 5, 2; ímpar (linha
// final incompleta de qualquer forma) e larguras menores mantêm o auto-fill.
export function balancedColumns(n: number): number | null {
  if (n < 2 || n % 2 !== 0) return null;
  for (const c of [4, 3, 5, 2]) if (n % c === 0) return c;
  return null;
}

export function TopPostsBlock({ block, snapshot }: BlockProps) {
  const raw = block.config?.count;
  const count = typeof raw === 'number' && raw >= 1 && raw <= 12 ? raw : DEFAULT_COUNT;
  const posts = snapshot.top_posts.slice(0, count);
  if (posts.length === 0) return null;
  const cols = block.size === 'full' ? balancedColumns(posts.length) : null;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: cols
          ? `repeat(${cols}, minmax(0, 1fr))`
          : 'repeat(auto-fill, minmax(180px, 1fr))',
        gap: '0.75rem',
      }}
    >
      {posts.map((post, i) => (
        <article key={i} className="rb-card rb-card--flush">
          {post.thumbnail_url ? (
            <img
              src={post.thumbnail_url}
              alt=""
              style={{ width: '100%', aspectRatio: '1', objectFit: 'cover' }}
            />
          ) : (
            <div
              className="rb-thumb-placeholder"
              style={{
                width: '100%',
                aspectRatio: '1',
                background: 'rgba(0,0,0,0.06)',
                display: 'grid',
                placeItems: 'center',
                fontSize: '0.75rem',
                opacity: 0.6,
              }}
            >
              {TYPE_LABELS[post.type]}
            </div>
          )}
          <div style={{ padding: '0.6rem' }}>
            <p
              style={{ margin: 0, fontSize: '0.7rem', opacity: 0.6 }}
            >{`${i + 1}º · ${TYPE_LABELS[post.type]}`}</p>
            <p
              style={{
                margin: '0.2rem 0 0',
                fontSize: '0.8rem',
                lineHeight: 1.35,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}
            >
              {post.caption_preview}
            </p>
            <p style={{ margin: '0.4rem 0 0', fontSize: '0.72rem', opacity: 0.75 }}>
              {typeof post.views === 'number'
                ? `Vis. ${fmtCount(post.views)} · ♥ ${fmtCount(post.likes)} · Com. ${fmtCount(post.comments)} · Salv. ${fmtCount(post.saves)}`
                : `Alc. ${fmtCount(post.reach)} · ♥ ${fmtCount(post.likes)} · Com. ${fmtCount(post.comments)} · Salv. ${fmtCount(post.saves)}`}
            </p>
          </div>
        </article>
      ))}
    </div>
  );
}
