// =============================================
// Mesaas - TikTok Integration Service
// =============================================
// Phase A: connect/sync/disconnect/read surface (EDGE_FUNCTION_URL, tiktok-integration).
// Phase C adds the publishing surface (PUBLISH_FUNCTION_URL, tiktok-publish, gateway JWT) —
// schedule/cancel/publish-now/retry/creator-info — mirroring instagram.ts's equivalents so
// ScheduleButton (Task C3) can treat both platforms uniformly.
//
// Mirrors instagram.ts's structure: 5-min in-memory cache, session-token
// fetch helper, cache invalidation on mutating calls.
import { supabase } from '../lib/supabase';

const EDGE_FUNCTION_URL = import.meta.env.VITE_SUPABASE_URL + '/functions/v1/tiktok-integration';
const PUBLISH_FUNCTION_URL = import.meta.env.VITE_SUPABASE_URL + '/functions/v1/tiktok-publish';

// ─── Response types (mirror supabase/functions/tiktok-integration/handlers.ts) ────

export interface TikTokAccount {
  id: string;
  client_id: number;
  tiktok_open_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  profile_deep_link: string | null;
  follower_count: number | null;
  following_count: number | null;
  likes_count: number | null;
  video_count: number | null;
  access_token_expires_at: string | null;
  refresh_token_expires_at: string | null;
  last_synced_at: string | null;
  created_at: string;
  authorization_status: 'active' | 'revoked' | 'disconnected' | 'expired';
  scopes: string[] | null;
  auto_sync_enabled: boolean;
}

export interface TikTokFollowerHistoryEntry {
  date: string;
  follower_count: number;
  [key: string]: unknown;
}

export interface TikTokSummary {
  account: TikTokAccount;
  follower_history: TikTokFollowerHistoryEntry[];
}

export interface TikTokPost {
  id: string;
  tiktok_account_id: string;
  tiktok_video_id: string;
  title: string | null;
  video_description: string | null;
  duration: number | null;
  height: number | null;
  width: number | null;
  share_url: string | null;
  embed_link: string | null;
  cover_image_url: string | null;
  posted_at: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  synced_at: string | null;
  created_at: string;
}

export interface TikTokPostsPage {
  posts: TikTokPost[];
  total: number | null;
}

export interface TikTokSyncResult {
  ok: boolean;
  synced_posts: number;
  refreshed_posts: number;
}

// Simple in-memory cache with 5-minute TTL
const cache = new Map<string, { data: any; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000;

function getCached(key: string): any | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
  cache.delete(key);
  return null;
}

function setCache(key: string, data: any) {
  cache.set(key, { data, ts: Date.now() });
}

function invalidateCache(clientId: number) {
  for (const key of cache.keys()) {
    if (key.includes(`/${clientId}`)) cache.delete(key);
  }
}

async function getAuthHeaders() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return {
    apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
    Authorization: `Bearer ${session?.access_token}`,
    'Content-Type': 'application/json',
  };
}

export async function getTikTokAuthUrl(clientId: number): Promise<string> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${EDGE_FUNCTION_URL}/auth/${clientId}`, { headers });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || 'Error generating auth url');
  }

  const data = await res.json();
  return data.url;
}

export async function syncTikTokData(clientId: number): Promise<TikTokSyncResult> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${EDGE_FUNCTION_URL}/sync/${clientId}`, {
    method: 'POST',
    headers,
  });

  const data = await res.json();
  if (!res.ok) {
    if (data.code === 'TOKEN_EXPIRED') {
      throw new Error('TOKEN_EXPIRED');
    }
    throw new Error(data.message || 'Error syncing data');
  }
  invalidateCache(clientId);
  return data;
}

export async function refreshTikTokToken(clientId: number): Promise<{ ok: boolean }> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${EDGE_FUNCTION_URL}/refresh/${clientId}`, {
    method: 'POST',
    headers,
  });

  const data = await res.json();
  if (!res.ok) {
    if (data.code === 'TOKEN_EXPIRED') {
      throw new Error('TOKEN_EXPIRED');
    }
    throw new Error(data.message || 'Error refreshing token');
  }
  invalidateCache(clientId);
  return data;
}

export async function disconnectTikTok(clientId: number): Promise<void> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${EDGE_FUNCTION_URL}/disconnect/${clientId}`, {
    method: 'POST',
    headers,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || 'Error disconnecting');
  }
  invalidateCache(clientId);
}

export async function getTikTokSummary(clientId: number): Promise<TikTokSummary | null> {
  const cacheKey = `summary/${clientId}`;
  const cached = getCached(cacheKey);
  if (cached !== null) return cached;

  const headers = await getAuthHeaders();
  const res = await fetch(`${EDGE_FUNCTION_URL}/summary/${clientId}`, { headers });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || 'Error fetching summary');
  }

  const data = await res.json();
  if (data.exists === false) return null;
  setCache(cacheKey, data);
  return data;
}

export async function getTikTokPosts(clientId: number, page: number = 1): Promise<TikTokPostsPage> {
  const cacheKey = `posts/${clientId}?page=${page}`;
  const cached = getCached(cacheKey);
  if (cached !== null) return cached;

  const headers = await getAuthHeaders();
  const res = await fetch(`${EDGE_FUNCTION_URL}/posts/${clientId}?page=${page}`, { headers });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || 'Error fetching posts');
  }

  const data = await res.json();
  setCache(cacheKey, data);
  return data;
}

// ─── Publishing (Phase C) ───────────────────────────────────────────────
// Hits tiktok-publish, a separate gateway-JWT edge function from tiktok-integration
// above — no anon apikey header (mirrors instagram.ts's schedule/cancel/retry/
// publish-now, which are also gateway-JWT-only). Never cached: creator-info is an
// audit requirement (must reflect live TikTok state on every open) and the
// schedule/cancel/retry/publish-now actions mutate post state, so caching them would
// only ever serve stale data.

export interface TikTokCreatorInfo {
  creator_nickname?: string;
  creator_avatar_url?: string;
  privacy_level_options?: string[];
  comment_disabled?: boolean;
  duet_disabled?: boolean;
  stitch_disabled?: boolean;
  max_video_post_duration_sec?: number;
}

async function getPublishAuthHeaders(): Promise<{
  Authorization: string;
  'Content-Type': string;
}> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  return {
    Authorization: `Bearer ${session.access_token}`,
    'Content-Type': 'application/json',
  };
}

export async function getTikTokCreatorInfo(clientId: number): Promise<TikTokCreatorInfo> {
  const headers = await getPublishAuthHeaders();
  const res = await fetch(`${PUBLISH_FUNCTION_URL}/creator-info/${clientId}`, { headers });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error ?? 'Erro ao consultar informações do criador no TikTok');
  }
  return data;
}

export async function scheduleTikTokPost(
  postId: number,
  scheduledAt: string,
): Promise<{ ok: boolean; status: string }> {
  const headers = await getPublishAuthHeaders();
  const res = await fetch(`${PUBLISH_FUNCTION_URL}/schedule/${postId}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ scheduled_at: scheduledAt }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.details?.join('; ') ?? data.error ?? 'Erro ao agendar');
  return data;
}

export async function cancelTikTokSchedule(postId: number): Promise<{ ok: boolean }> {
  const headers = await getPublishAuthHeaders();
  const res = await fetch(`${PUBLISH_FUNCTION_URL}/cancel/${postId}`, {
    method: 'POST',
    headers,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Erro ao cancelar');
  return data;
}

export async function publishTikTokPostNow(
  postId: number,
): Promise<{ ok: boolean; status: string; message?: string }> {
  const headers = await getPublishAuthHeaders();
  const res = await fetch(`${PUBLISH_FUNCTION_URL}/publish-now/${postId}`, {
    method: 'POST',
    headers,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.details?.join('; ') ?? data.error ?? 'Erro ao publicar');
  return data;
}

export async function retryTikTokPublish(postId: number): Promise<{ ok: boolean }> {
  const headers = await getPublishAuthHeaders();
  const res = await fetch(`${PUBLISH_FUNCTION_URL}/retry/${postId}`, {
    method: 'POST',
    headers,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'Erro ao reenviar');
  return data;
}
