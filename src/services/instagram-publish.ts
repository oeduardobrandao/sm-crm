import { supabase } from '../lib/supabase';

const EDGE_FUNCTION_URL = import.meta.env.VITE_SUPABASE_URL + '/functions/v1/instagram-publish';

async function getAuthHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return {
    'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY as string,
    'Authorization': `Bearer ${session?.access_token}`,
    'Content-Type': 'application/json',
  };
}

export async function scheduleInstagramPost(
  postId: number,
  opts: {
    caption: string;
    scheduled_at: string; // ISO string
    cover_url?: string;
    music_note?: string;
  }
): Promise<{ success: boolean; container_id: string }> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${EDGE_FUNCTION_URL}/schedule/${postId}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(opts),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Error scheduling post');
  }
  return res.json();
}

export async function publishInstagramPostNow(
  postId: number,
  opts: {
    caption: string;
    cover_url?: string;
    music_note?: string;
  }
): Promise<{ success: boolean; media_id: string }> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${EDGE_FUNCTION_URL}/schedule/${postId}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(opts), // no scheduled_at = publish now
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Error publishing post');
  }
  return res.json();
}

export async function cancelInstagramSchedule(postId: number): Promise<void> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${EDGE_FUNCTION_URL}/cancel/${postId}`, {
    method: 'DELETE',
    headers,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Error canceling schedule');
  }
}

export async function getInstagramPublishStatus(postId: number): Promise<{ status: string; error?: string }> {
  const headers = await getAuthHeaders();
  const res = await fetch(`${EDGE_FUNCTION_URL}/status/${postId}`, { headers });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || 'Error checking status');
  }
  return res.json();
}
