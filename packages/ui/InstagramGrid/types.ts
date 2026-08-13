/**
 * Shared shapes for the Instagram grid preview. Both the Hub (client-facing
 * modal) and the CRM (entregas drawer tab) normalize their own post/feed data
 * into these before handing them to <InstagramGrid/>, so the grid itself stays
 * free of any app-specific types or data-fetching.
 */

export interface GridProfile {
  username: string | null;
  profilePictureUrl: string | null;
  followerCount: number;
  followingCount: number;
  mediaCount: number;
}

export interface GridItem {
  /** Where the tile came from — a planned post ('hub') or the live IG feed ('live'). */
  source: 'hub' | 'live';
  /** movable = a planned post whose publish date may be swapped; fixed = an anchor that never moves. */
  mobility: 'movable' | 'fixed';
  /** Stable React key, unique across sources (e.g. `hub-123` / `live-abc`). */
  id: string;
  /** The workflow_posts id for movable posts; null for live-feed anchors. */
  postId: number | null;
  /** Raw post status, used only for the agendado future-slot guard. */
  status: string | null;
  /** The image shown in the tile — full-res for planned covers, poster for videos, IG thumb for live. */
  thumbnailUrl: string | null;
  videoUrl: string | null;
  /** Tiny blurred data URL for a blur-up placeholder while the tile image loads. */
  blurDataUrl?: string | null;
  /** 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM'. */
  mediaType: string;
  isCarousel: boolean;
  scheduledAt: string | null;
  /** Effective timestamp used to seed the newest-first feed order (published_at ?? scheduled_at ?? postedAt). */
  sortTs: string;
}

export interface ReorderUpdate {
  post_id: number;
  scheduled_at: string | null;
}
