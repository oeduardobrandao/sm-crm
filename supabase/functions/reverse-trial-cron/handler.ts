// reverse-trial-cron: ends every reverse trial (14 days of Pro without a card) whose
// reverse_trial_ends_at has passed (spec docs/superpowers/specs/2026-11-24-reverse-trial-design.md,
// Part 5). Runs every 15 minutes. The transition itself is end_reverse_trial (SQL, locked on the
// workspace row): it re-checks plan_source = 'trial' and refuses while a paid subscription is in
// force, so a webhook converting the same workspace concurrently can never be overwritten.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const DB_TIMEOUT_MS = 10_000;

/** Bounded fetch per run; anything left over is picked up 15 minutes later. */
export const BATCH_LIMIT = 200;

export interface ReverseTrialCronDeps {
  db: Pick<SupabaseClient, "from" | "rpc">;
  now: () => Date;
  /** Best-effort analytics (capturePostHog); a failure is logged, never fails the run. */
  capture: (event: string, distinctId: string, props: Record<string, unknown>) => Promise<void>;
}

export interface ReverseTrialCronResult {
  ended: number;
  skipped: number;
  errors: string[];
}

export async function runReverseTrialCron(
  deps: ReverseTrialCronDeps,
): Promise<ReverseTrialCronResult> {
  const now = deps.now();
  const { data, error } = await deps.db
    .from("workspaces")
    .select("id, created_by")
    .eq("plan_source", "trial")
    .lte("reverse_trial_ends_at", now.toISOString())
    .order("reverse_trial_ends_at", { ascending: true })
    .limit(BATCH_LIMIT)
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
  if (error) throw new Error(`expired trials read failed: ${error.message}`);

  const result: ReverseTrialCronResult = { ended: 0, skipped: 0, errors: [] };
  for (const row of (data ?? []) as Array<{ id: string; created_by: string | null }>) {
    try {
      const { data: ended, error: endErr } = await deps.db
        .rpc("end_reverse_trial", { p_workspace: row.id, p_outcome: "downgraded" })
        .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
      if (endErr) {
        result.errors.push(`${row.id}: ${endErr.message}`);
        continue;
      }
      if (ended !== true) {
        // Not a trial any more (converted between the read and the lock) or a paid
        // subscription is in force: the conversion path owns this workspace.
        result.skipped++;
        continue;
      }
      result.ended++;
      if (row.created_by) {
        try {
          await deps.capture("reverse_trial_ended", row.created_by, {
            outcome: "downgraded",
            $groups: { workspace: row.id },
          });
        } catch (e) {
          console.warn(
            `[reverse-trial-cron] posthog capture failed for ${row.id}:`,
            e instanceof Error ? e.message : String(e),
          );
        }
      }
    } catch (e) {
      result.errors.push(`${row.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return result;
}

export interface ReverseTrialCronHandlerDeps {
  cronSecret: string;
  timingSafeEqual: (a: string, b: string) => boolean;
  run: (req: Request) => Promise<Response>;
}

export function createReverseTrialCronHandler(deps: ReverseTrialCronHandlerDeps) {
  return async (req: Request): Promise<Response> => {
    if (!deps.timingSafeEqual(req.headers.get("x-cron-secret") ?? "", deps.cronSecret)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    return deps.run(req);
  };
}
