import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { chunk, fetchAllRows } from "../_shared/paginate.ts";
import {
  activationCutoff,
  computeReverseTrialFunnel,
  type CreatedRow,
  type FunnelTrialRow,
  isFunnelExcluded,
} from "./reverse-trial-funnel-logic.ts";

// UUIDs are 36 chars: 200 per .in() keeps the PostgREST URL well under the gateway limit.
const ID_CHUNK = 200;

/**
 * Reverse-trial funnel for the Admin dashboard: started, activated by day 7, card added,
 * paid, downgraded. One paginated read of the trial workspaces, then batched reads of
 * clientes and workflow_posts bounded by each chunk's latest day-7 cutoff.
 */
export async function handleGetReverseTrialFunnel(
  svc: SupabaseClient,
  headers: Record<string, string>,
  now: Date = new Date(),
) {
  const all = await fetchAllRows<FunnelTrialRow>((from, to) =>
    svc
      .from("workspaces")
      .select(
        "id, is_internal, demo_created_at, plan_source, reverse_trial_started_at, reverse_trial_ended_at, reverse_trial_outcome, reverse_trial_card_added_at, reverse_trial_first_paid_at",
      )
      .not("reverse_trial_started_at", "is", null)
      .order("id", { ascending: true })
      .range(from, to),
  );
  const trials = all.filter((t) => !isFunnelExcluded(t));

  const clients: CreatedRow[] = [];
  const posts: CreatedRow[] = [];
  for (const group of chunk(trials, ID_CHUNK)) {
    const ids = group.map((t) => t.id);
    const bound = new Date(Math.max(...group.map((t) => activationCutoff(t.reverse_trial_started_at)))).toISOString();
    const [c, p] = await Promise.all([
      fetchAllRows<CreatedRow>((from, to) =>
        svc
          .from("clientes")
          .select("conta_id, created_at")
          .in("conta_id", ids)
          .lte("created_at", bound)
          .order("id", { ascending: true })
          .range(from, to)
      ),
      fetchAllRows<CreatedRow>((from, to) =>
        svc
          .from("workflow_posts")
          .select("conta_id, created_at")
          .in("conta_id", ids)
          .lte("created_at", bound)
          .order("id", { ascending: true })
          .range(from, to)
      ),
    ]);
    clients.push(...c);
    posts.push(...p);
  }

  return new Response(JSON.stringify(computeReverseTrialFunnel(trials, clients, posts, now)), {
    status: 200,
    headers,
  });
}
