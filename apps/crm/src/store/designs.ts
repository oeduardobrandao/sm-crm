import { supabase } from './core';

// Estúdio designs (design-first model, spec 2026-07-04). Reads are direct RLS selects
// (designs grants SELECT to authenticated, scoped by conta); ALL writes go through the
// design-manage edge function → service-role RPCs.

export interface DesignSummary {
  id: number;
  rev: number;
  render_status: 'pending' | 'rendering' | 'rendered' | 'failed';
  is_stale: boolean;
  post_id: number | null;
  format: string;
  name: string;
}

/** The design attached to a post, if any. Direct RLS select — NEVER the edge function
 * (creation is explicit now; GET /blob is a plain fetch). Null = post has no design. */
export async function getDesignForPost(postId: number): Promise<DesignSummary | null> {
  const { data, error } = await supabase
    .from('designs')
    .select('id, rev, render_status, is_stale, post_id, format, name')
    .eq('post_id', postId)
    .maybeSingle();
  if (error) throw error;
  return data as DesignSummary | null;
}

/** Create a design via design-manage POST /designs (authed-fetch pattern from
 * services/postMedia.ts). With post_id the design is born attached (format derives from the
 * post's tipo); standalone creations pass format explicitly. */
export async function createDesign(input: {
  post_id?: number;
  format?: string;
  cliente_id?: number;
  name?: string;
}): Promise<{ design_id: number }> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  const url = `${import.meta.env.VITE_SUPABASE_URL as string}/functions/v1/design-manage/designs`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<{ design_id: number }>;
}
