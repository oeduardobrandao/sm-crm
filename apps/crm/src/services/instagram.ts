// =============================================
// Mesaas - Instagram Integration Service
// =============================================
import { supabase } from '../lib/supabase';

const EDGE_FUNCTION_URL = import.meta.env.VITE_SUPABASE_URL + '/functions/v1/instagram-integration';

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
  const { data: { session } } = await supabase.auth.getSession();
  return {
    'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY as string,
    'Authorization': `Bearer ${session?.access_token}`,
    'Content-Type': 'application/json'
  };
}

export async function getInstagramAuthUrl(clientId: number): Promise<string> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${EDGE_FUNCTION_URL}/auth/${clientId}`, { headers });
  
  if (!res.ok) {
     const data = await res.json().catch(() => ({}));
     throw new Error(data.message || 'Error generating auth url');
  }
  
  const data = await res.json();
  return data.url;
}

export async function disconnectInstagram(clientId: number): Promise<void> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${EDGE_FUNCTION_URL}/disconnect/${clientId}`, {
      method: 'POST',
      headers
  });
  
  if (!res.ok) {
     const data = await res.json().catch(() => ({}));
     throw new Error(data.message || 'Error disconnecting');
  }
  invalidateCache(clientId);
}

export async function syncInstagramData(clientId: number): Promise<void> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${EDGE_FUNCTION_URL}/sync/${clientId}`, {
      method: 'POST',
      headers
  });

  if (!res.ok) {
     const data = await res.json().catch(() => ({}));
     if (data.code === 'TOKEN_EXPIRED') {
         throw new Error('TOKEN_EXPIRED');
     }
     throw new Error(data.message || 'Error syncing data');
  }
  invalidateCache(clientId);
}

export async function getInstagramSummary(clientId: number): Promise<any> {
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

export async function getInstagramPosts(clientId: number, page: number = 1): Promise<any> {
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

