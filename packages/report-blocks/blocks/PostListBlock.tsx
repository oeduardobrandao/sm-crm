import type { BlockProps } from '../BlockRenderer';
import { fmtCount } from '../format';

export function PostListBlock({ block, snapshot }: BlockProps) {
  const raw = block.config?.count;
  const count = typeof raw === 'number' && raw >= 1 && raw <= 12 ? raw : 12;
  const posts = snapshot.top_posts.slice(0, count);
  if (posts.length === 0) return null;
  return (
    <div style={{ border: '1px solid rgba(0,0,0,0.08)', borderRadius: 12, padding: '0.5rem 1rem' }}>
      {posts.map((post, i) => (
        <div key={i} style={{ display: 'flex', gap: '0.75rem', alignItems: 'baseline', padding: '0.45rem 0', borderBottom: i < posts.length - 1 ? '1px solid rgba(0,0,0,0.06)' : 'none' }}>
          <span style={{ fontSize: '0.75rem', opacity: 0.6, width: 24 }}>{i + 1}º</span>
          <span style={{ flex: 1, fontSize: '0.82rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{post.caption_preview}</span>
          <span style={{ fontSize: '0.75rem', opacity: 0.75 }}>{fmtCount(post.reach)}</span>
        </div>
      ))}
    </div>
  );
}
