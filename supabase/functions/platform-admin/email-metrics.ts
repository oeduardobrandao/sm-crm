// Admin "E-mails" page: reads the email_metrics RPC (service_role) for a date range. The admin
// gate (platform_admins) already happened in index.ts. Errors out are generic; the raw rpc error
// is never logged (it could echo SQL values), only the step name.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

type Headers = Record<string, string>;

const DAY_MS = 86_400_000;
// Mirrors the RPC guard (p_end - p_start > 365 raises): at most 366 inclusive days.
const MAX_DIFF_DAYS = 365;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const json = (body: unknown, status: number, headers: Headers) =>
  new Response(JSON.stringify(body), { status, headers });

function parseDay(v: unknown): number | null {
  if (typeof v !== "string" || !DATE_RE.test(v)) return null;
  const ms = Date.parse(`${v}T00:00:00Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== v) return null;
  return ms;
}

export function parseEmailMetricsRange(body: unknown): { start: string; end: string } | { error: string } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const s = parseDay(b.start);
  const e = parseDay(b.end);
  if (s === null || e === null) return { error: "invalid_range" };
  if (e < s) return { error: "invalid_range" };
  if ((e - s) / DAY_MS > MAX_DIFF_DAYS) return { error: "range_too_long" };
  return { start: b.start as string, end: b.end as string };
}

export async function handleEmailMetrics(
  svc: SupabaseClient,
  body: unknown,
  headers: Headers,
): Promise<Response> {
  const range = parseEmailMetricsRange(body);
  if ("error" in range) return json({ error: range.error }, 400, headers);
  const { data, error } = await svc.rpc("email_metrics", { p_start: range.start, p_end: range.end });
  if (error || data == null) {
    console.error("[platform-admin] email-metrics: rpc failed");
    return json({ error: "Internal server error" }, 500, headers);
  }
  return json(data, 200, headers);
}
