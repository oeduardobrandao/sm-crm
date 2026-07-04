// T6.4 — AI-image monthly quota for the panel's meter. Counts with the SAME reservation
// predicate the server uses (succeeded OR pending<10min, current UTC month) so the UI matches
// server truth; useGenerateImage overwrites this cache with the response's own quota after a
// spend. The monthly limit comes from the plan (useWorkspaceLimits), not this count.
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export interface AiImageQuota {
  used: number;
  limit: number | null;
  resets_at: string;
}

export function aiImageQuotaKey() {
  return ['estudio-ai-image-quota'] as const;
}

const RESERVATION_WINDOW_MS = 10 * 60 * 1000;

function monthBoundsUtc(now: Date): { start: string; resetsAt: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), resetsAt: next.toISOString() };
}

/** RLS-scoped count (members read their own workspace's ledger rows) of this month's
 * reservation set. `limit` is supplied by the caller from the plan. */
export function useAiImageQuota(limit: number | null, enabled: boolean) {
  return useQuery<AiImageQuota>({
    queryKey: aiImageQuotaKey(),
    queryFn: async () => {
      const now = new Date();
      const { start, resetsAt } = monthBoundsUtc(now);
      const { data, error } = await supabase
        .from('ai_image_generations')
        .select('status, created_at')
        .gte('created_at', start);
      if (error) throw error;
      const staleBefore = new Date(now.getTime() - RESERVATION_WINDOW_MS).toISOString();
      const used = (data ?? []).filter(
        (r) =>
          r.status === 'succeeded' ||
          (r.status === 'pending' && (r.created_at as string) > staleBefore),
      ).length;
      return { used, limit, resets_at: resetsAt };
    },
    enabled,
    staleTime: 60 * 1000,
  });
}
