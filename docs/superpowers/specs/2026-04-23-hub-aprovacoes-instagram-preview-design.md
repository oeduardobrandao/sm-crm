# Hub Aprovações — Instagram Preview Redesign

**Date:** 2026-04-23
**Status:** Approved
**Scope:** Hub app (`apps/hub/src/`) + new edge function

## Overview

Redesign the Hub Aprovações page to give clients a realistic preview of how their posts will look on Instagram. Three interconnected changes:

1. Group posts by media presence (with media vs without)
2. Render posts with media as Instagram post previews
3. Add a full-screen Instagram profile grid preview with drag-to-reorder

## 1. Page Layout — Post Grouping

The Aprovações page splits into two sections:

**Section 1: Posts with media** (top)
- Rendered as `InstagramPostCard` components in a 2-column responsive grid (`grid-cols-1 sm:grid-cols-2`)
- Each card has a selection checkbox for the grid preview feature
- A `FeedPreviewButton` appears when 1+ posts are selected

**Section 2: Posts without media** (bottom)
- Rendered as `TextPostCard` components in a single-column layout (`max-w-640px`)
- Separated from media posts by a visual divider

Posts are split by checking `post.media.length > 0`. This includes images and videos — a video-only post counts as "with media."

## 2. InstagramPostCard

Replaces `PostCard` for posts that have media (images or videos). Mimics a real Instagram post.

**Structure (top to bottom):**

1. **Selection checkbox** — Circular, positioned top-right over the image. Unchecked: semi-transparent dark circle with white check. Checked: solid blue (#0095f6) circle, card gets blue border + subtle blue shadow.

2. **Profile header** — Instagram account's profile picture (32px circle) + username (bold, 13px) + optional location. Three-dot menu icon on the right (decorative only).

3. **Image area** — 4:5 aspect ratio. For carousel posts (`tipo === 'carrossel'` or `media.length > 1`): left/right navigation arrows on hover, dot indicators below. For single image posts: just the image. Clicking the image opens the existing `PostMediaLightbox`.

4. **Action icons row** — Heart, Comment, Share (left-aligned), Bookmark (right-aligned). Decorative only, not interactive. Uses SVG icons matching Instagram's style.

5. **Caption** — Username (bold) followed by `conteudo_plain`. Truncated to 3 lines with "mais" (more) toggle to expand.

6. **Scheduled date** — Small muted text: "Agendado: {formatted date}".

7. **Approval buttons** — "Aprovar" (green) and "Solicitar Alteração" (outlined). Same approval flow as current PostCard — calls `submitApproval()` from `api.ts`.

**Data needed:** Instagram `username` and `profile_picture_url` from the extended `hub-posts` response.

## 3. TextPostCard

New compact card for posts without media. No placeholder image.

**Collapsed state (default):**
- Single row layout with type badge (Feed/Reels/Stories/Carrossel), status indicator, and scheduled date
- Post title (bold, 14px)
- Caption truncated to single line with ellipsis
- Chevron icon (right side) to expand
- Entire card is clickable to toggle

**Expanded state:**
- Full caption text with `white-space: pre-wrap` (preserves line breaks)
- Approval buttons appear (same as InstagramPostCard)
- Chevron rotates 180° (points up)
- Subtle border darkening + shadow to indicate active state

## 4. FeedPreviewButton

Appears when 1+ `InstagramPostCard` items are selected via checkbox.

- Centered below the image posts grid
- Blue button (#0095f6): grid icon + "Visualizar no Feed ({n} selecionado(s))"
- Clicking opens `InstagramGridPreview` modal
- Hidden when no posts are selected

**Selection state:** Managed in `AprovacoesPage` as a `Set<number>` of post IDs. Passed to each `InstagramPostCard` as `isSelected` + `onToggleSelect`.

## 5. InstagramGridPreview

Full-screen modal mimicking Instagram's native profile page.

### Profile header
Matches Instagram's layout based on the reference screenshot:

- **Top bar:** Username + dropdown chevron (centered)
- **Profile section:** Profile pic (86px, with blue "+" circle) on the left. Stats on the right: posts count, seguidores (followers), seguindo (following) — numbers bold, labels below.
- **Bio section:** Display name and bio are not currently stored in `instagram_accounts`, so this section is omitted. Can be added in a future sync enhancement.
- **Action buttons row:** "Seguir", "Mensagem", "Contato" (decorative, non-interactive)
- **Tab bar:** 4 tabs — Grid (active), Reels, Reposts, Tagged. Only grid tab is functional.

### Drag hint
Blue bar below the tab bar: "Arraste os posts novos para reordenar" with a move icon.

### Grid
- 3-column grid, 1.5px gap, 4:5 aspect ratio per cell
- **Initial layout:** Pending posts at the top, live posts below. After the first drag, pending posts may appear anywhere in the grid.
- **Pending posts:** Blue inset border (2.5px). "Novo" badge (top-left). View count shows "—". Carousel/Reels icons where applicable (top-right).
- **Live posts:** Ordered by `posted_at` DESC. Show real `thumbnail_url` images (gray placeholder on load failure). View count (eye icon + impressions) at bottom-left. Carousel/Reels type icons at top-right.
- **30 live posts loaded** (10 rows of 3), scrollable

### Drag-and-drop
- **HTML5 Drag and Drop API** for desktop
- **Touch event fallback** (`touchstart`/`touchmove`/`touchend`) for mobile
- No external library
- Visual feedback: dragged item at 50% opacity, drop target gets blue outline
- Reordering is visual only — modifies a local array state, no API calls, no persistence
- Only pending posts are draggable. They can be moved to any position in the grid (including between live posts) so the client can see how they'd look in different spots. Live posts shift to accommodate but are not themselves draggable.

### Legend
Bottom of modal: blue dot = "Posts para aprovar", gray dot = "Posts publicados".

### Loading state
Skeleton grid while `hub-instagram-feed` data is loading. Profile header area shows skeleton bars.

## 6. Data Layer

### Extended `hub-posts` response

Add to the existing `hub-posts` handler:

```typescript
// After resolving hubToken.cliente_id:
const { data: igAccount } = await db
  .from("instagram_accounts")
  .select("username, profile_picture_url")
  .eq("client_id", hubToken.cliente_id)
  .maybeSingle();
```

Added to the response object:
```typescript
{
  posts, postApprovals, propertyValues, workflowSelectOptions,
  // NEW:
  instagramProfile: igAccount ? {
    username: igAccount.username,          // nullable in DB
    profilePictureUrl: igAccount.profile_picture_url,  // nullable in DB
  } : null
}
```

The `instagramProfile` field is always included in the response — even on the early-return path when no workflows exist (currently returns `{ posts: [], postApprovals: [] }`). That early return must be updated to include `propertyValues: [], workflowSelectOptions: [], instagramProfile: ...` so the response shape is consistent.

When `instagramProfile` is `null` (no Instagram account linked), media posts fall back to showing the workspace name in the profile header and no profile picture. The grid preview button is hidden entirely.

### New `hub-instagram-feed` edge function

**Endpoint:** `GET /functions/v1/hub-instagram-feed?token={token}`

**Config:** Requires `verify_jwt = false` entry in `supabase/config.toml` (Hub endpoints use token-based auth, not JWT). Add:
```toml
[functions.hub-instagram-feed]
verify_jwt = false
```

**Auth:** Validates hub token from `client_hub_tokens` table (same pattern as `hub-posts`).

**Response:**
```typescript
{
  profile: {
    username: string | null;          // nullable in DB schema
    profilePictureUrl: string | null; // nullable in DB schema
    followerCount: number;
    followingCount: number;
    mediaCount: number;
    // bio/display name not stored in instagram_accounts currently,
    // so these are omitted from the profile section in the grid preview
  },
  recentPosts: Array<{
    id: string;                    // instagram_post_id
    thumbnailUrl: string | null;   // nullable — sync stores null when no thumbnail available
    mediaType: string;             // IMAGE, VIDEO, CAROUSEL_ALBUM
    permalink: string;
    postedAt: string;              // ISO datetime
    impressions: number;           // used for view count display
  }>
}
```

**No Instagram account linked:** Returns `404` with `{ error: "Conta Instagram não encontrada." }`. The frontend should not call this endpoint when `instagramProfile` is `null` from `hub-posts`, but the 404 is a safety net.

**Nullable fallbacks:**
- `username` null → show workspace name instead
- `profilePictureUrl` null → show initial letter avatar
- `thumbnailUrl` null → show gray placeholder cell in grid

**Query:**
```typescript
// 1. Validate token → get cliente_id, conta_id
// 2. Fetch instagram_accounts WHERE client_id = cliente_id
// 3. Fetch instagram_posts WHERE instagram_account_id = account.id
//    ORDER BY posted_at DESC LIMIT 30
```

**Workspace ownership check:** Verify `conta_id` matches the hub token's `conta_id` before returning data (security requirement from CLAUDE.md).

### New Hub API function

In `apps/hub/src/api.ts`:
```typescript
export async function fetchInstagramFeed(token: string): Promise<InstagramFeedData> {
  // GET /functions/v1/hub-instagram-feed?token={token}
}
```

Called with React Query: `useQuery(['hub-instagram-feed', token], ...)` — only triggered when the grid preview modal opens.

## 7. New TypeScript Types

In `apps/hub/src/types.ts`:

```typescript
interface InstagramProfile {
  username: string | null;
  profilePictureUrl: string | null;
}

interface InstagramFeedProfile extends InstagramProfile {
  followerCount: number;
  followingCount: number;
  mediaCount: number;
}

interface InstagramFeedPost {
  id: string;
  thumbnailUrl: string | null;
  mediaType: 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM';
  permalink: string;
  postedAt: string;
  impressions: number;
}

interface InstagramFeedData {
  profile: InstagramFeedProfile;
  recentPosts: InstagramFeedPost[];
}
```

## 8. File Changes Summary

**New files:**
- `apps/hub/src/components/InstagramPostCard.tsx`
- `apps/hub/src/components/TextPostCard.tsx`
- `apps/hub/src/components/InstagramGridPreview.tsx`
- `apps/hub/src/components/FeedPreviewButton.tsx`
- `supabase/functions/hub-instagram-feed/index.ts`
- Tests for new components (InstagramPostCard, TextPostCard, InstagramGridPreview, FeedPreviewButton)
- Tests for `hub-instagram-feed` edge function

**Modified files:**
- `apps/hub/src/pages/AprovacoesPage.tsx` — Split posts, manage selection state, render new components
- `apps/hub/src/api.ts` — Add `fetchInstagramFeed()`, extract inline `fetchPosts` return type into a named interface, add `instagramProfile` field
- `apps/hub/src/types.ts` — Add Instagram-related types (`InstagramProfile`, `InstagramFeedProfile`, `InstagramFeedPost`, `InstagramFeedData`)
- `supabase/functions/hub-posts/handler.ts` — Add Instagram profile query to response; fix early-return path (no workflows) to include consistent response shape
- `supabase/config.toml` — Add `[functions.hub-instagram-feed]` with `verify_jwt = false`
- Existing `hub-posts` handler tests — Update to cover `instagramProfile` in response and consistent early-return shape

**Unchanged:**
- `apps/hub/src/components/PostMediaLightbox.tsx` — Reused as-is
- `apps/hub/src/router.tsx` — No new routes

## 9. Edge Cases

- **No Instagram account linked:** `instagramProfile` is `null`. Media posts show workspace name in profile header, initial letter avatar. Grid preview button is hidden.
- **No posts with media:** Only the text posts section renders. No grid preview button.
- **No posts without media:** Only the media posts section renders. No text section.
- **Null username/profile pic:** Fallback to workspace name and initial letter avatar respectively (see nullable fallbacks above).
- **Expired media URLs (R2):** Existing `onStaleUrl` pattern from `PostMediaLightbox` — refetch on 403.
- **Stale Instagram thumbnails:** Instagram CDN URLs in `instagram_posts.thumbnail_url` may expire. If an image fails to load in the grid preview, show a gray placeholder. These get refreshed on the next Instagram sync.
- **Single media vs carousel:** `InstagramPostCard` checks `post.media.length`. If > 1, show carousel dots + left/right arrows. If 1, just the media.
- **Video posts in grid preview:** Show the `thumbnail_url` with a Reels icon overlay (top-right), same as Instagram does.
- **Mobile responsiveness:** Media posts grid goes to single column on mobile. Grid preview modal goes full-screen (no border radius). Touch drag-and-drop enabled.
