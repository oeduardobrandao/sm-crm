import type { HubPost } from '../../types';
import { pickPostCardKind } from '../../lib/postView';
import { PostTile, type TileMode } from './PostTile';
import { StoriesRail } from './StoriesRail';

interface PostGridProps {
  posts: HubPost[];
  mode: TileMode;
  selectedIds: Set<number>;
  onOpen: (postId: number) => void;
  onToggle: (postId: number) => void;
}

/** Stories rail on top, then one chronological 4:5 grid of media and text tiles. */
export function PostGrid({ posts, mode, selectedIds, onOpen, onToggle }: PostGridProps) {
  const stories = posts.filter((p) => pickPostCardKind(p) === 'story');
  const tiles = posts.filter((p) => pickPostCardKind(p) !== 'story');
  return (
    <div>
      <StoriesRail posts={stories} onOpen={onOpen} dimmed={mode === 'select'} />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {tiles.map((post, i) => (
          <PostTile
            key={post.id}
            post={post}
            mode={mode}
            selected={selectedIds.has(post.id)}
            onOpen={onOpen}
            onToggle={onToggle}
            priority={i < 4}
          />
        ))}
      </div>
    </div>
  );
}
