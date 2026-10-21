import { saoPauloDate } from "../_shared/sao-paulo-date.ts";
import {
  type PricedSnapshotSource,
  type SnapshotRow,
  toSnapshotRows,
} from "../_shared/metrics-snapshot.ts";

export interface MetricsSnapshotDeps {
  cronSecret: string;
  timingSafeEqual: (a: string, b: string) => boolean;
  now: () => Date;
  loadPricedRows: () => Promise<PricedSnapshotSource[]>;
  /** Must throw on failure (fail closed): a snapshot with an internal workspace is permanent. */
  loadInternalIds: () => Promise<Set<string>>;
  write: (date: string, rows: SnapshotRow[]) => Promise<{ written: number; skipped: boolean }>;
  reportFailure: (message: string) => Promise<void>;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

export function createMetricsSnapshotHandler(deps: MetricsSnapshotDeps) {
  return async (req: Request): Promise<Response> => {
    if (!deps.timingSafeEqual(req.headers.get("x-cron-secret") ?? "", deps.cronSecret)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: JSON_HEADERS });
    }
    try {
      const date = saoPauloDate(deps.now());
      const [priced, internalIds] = await Promise.all([deps.loadPricedRows(), deps.loadInternalIds()]);
      const rows = toSnapshotRows(priced, internalIds);
      const { written } = await deps.write(date, rows);
      return new Response(JSON.stringify({ success: true, snapshot_date: date, written }), {
        status: 200,
        headers: JSON_HEADERS,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown";
      console.error("metrics-snapshot-cron failed:", message);
      await deps.reportFailure(message);
      return new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500,
        headers: JSON_HEADERS,
      });
    }
  };
}
