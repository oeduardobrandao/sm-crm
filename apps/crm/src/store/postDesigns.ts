import { supabase } from './core';

// Estúdio design summary (T4.3, docs/estudio-plan.md §5). READ-ONLY on purpose: post_designs
// grants SELECT to authenticated (RLS by conta), all writes go through the service-role RPCs.

export interface PostDesignSummary {
  id: number;
  rev: number;
  render_status: 'pending' | 'rendering' | 'rendered' | 'failed';
  is_stale: boolean;
}

/** Does this post have an Estúdio design, and is it flattened? Direct RLS select — NEVER the
 * post-design-manage GET route for this (that route is get-or-create: asking it "does a design
 * exist?" would MINT one). Null = no design. */
export async function getPostDesignSummary(postId: number): Promise<PostDesignSummary | null> {
  const { data, error } = await supabase
    .from('post_designs')
    .select('id, rev, render_status, is_stale')
    .eq('post_id', postId)
    .maybeSingle();
  if (error) throw error;
  return data as PostDesignSummary | null;
}
