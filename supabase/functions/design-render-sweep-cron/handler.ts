// design-render-sweep-cron — docs/estudio-design.md §5.2 T1.6. Safety net for design-render's
// fire-and-forget triggers (initial call from design-manage/MCP writes, and PR 1.5's chain
// self-invocation): re-fires any designs row stuck `pending`/`rendering` for more than the
// threshold. Droppable and safe to overlap with a still-alive render — claim_design_render's own
// 3-minute stale-lock means a re-fire against a row that isn't actually dead just no-ops (409, or
// 204 if the rev also moved), so this cron's shorter threshold is deliberately a fast-retry net,
// not a hard deadline.
//
// This handler does NOT decide what R2 objects a reclaim invalidates — an earlier version tried
// to reap the OLD render_manifest here using a snapshot read from findStuckRows(), but that is a
// genuine TOCTOU race: the snapshot can go stale (a slow-but-alive render can legitimately
// finalize between the snapshot read and this cron's re-fire call, without changing `rev`), so
// deciding from it risks queuing a just-finalized post's live media for deletion. That decision
// now lives entirely inside claim_design_render (see migration 20260702000004), which makes it
// atomically under the same row lock as the reclaim itself — the only place it can be race-free.

import { createJsonResponder } from "../_shared/http.ts";

export interface StuckDesignRow {
  id: number;
  rev: number;
}

export interface SweepFailureDetail {
  total: number;
  failed: number;
  errors: Array<{ designId: number; error: string }>;
}

export interface DesignRenderSweepCronDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  cronSecret: string;
  timingSafeEqual: (a: string, b: string) => boolean;
  findStuckRows: () => Promise<StuckDesignRow[]>;
  // Returns true when design-render responded 200 (claim_design_render actually reclaimed the
  // row — see the migration for what that entails). false means a harmless no-op (409
  // already-claimed, or 204 stale-rev) — the row wasn't actually dead.
  reFire: (designId: number, rev: number) => Promise<boolean>;
  reportFailure: (detail: SweepFailureDetail) => Promise<void>;
  logError: (context: string, error: unknown) => void;
}

export function createDesignRenderSweepCronHandler(deps: DesignRenderSweepCronDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    const json = createJsonResponder(cors);

    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

    if (!deps.timingSafeEqual(req.headers.get("x-cron-secret") ?? "", deps.cronSecret)) {
      return json({ error: "Unauthorized" }, 401);
    }

    const stuck = await deps.findStuckRows();

    let refired = 0;
    let skipped = 0;
    let failed = 0;
    const errors: Array<{ designId: number; error: string }> = [];

    for (const row of stuck) {
      try {
        const claimed = await deps.reFire(row.id, row.rev);
        if (claimed) refired++;
        else skipped++;
      } catch (e) {
        failed++;
        const message = e instanceof Error ? e.message : String(e);
        errors.push({ designId: row.id, error: message });
        deps.logError("design-render-sweep-cron", e);
      }
    }

    if (failed > 0) {
      await deps.reportFailure({ total: stuck.length, failed, errors });
    }

    return json({ swept: stuck.length, refired, skipped, failed });
  };
}
