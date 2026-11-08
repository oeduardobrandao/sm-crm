// Admin "E-mails" list: pages through email_sends via the email_sends_list RPC (service_role).
// The admin gate (platform_admins) already happened in index.ts. Errors out are generic; the raw
// rpc error is never logged (it could echo SQL values), only the step name.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { parseEmailMetricsRange } from "./email-metrics.ts";

type Headers = Record<string, string>;

export type EmailListInput = {
  start: string;
  end: string;
  categories: string[];
  types: string[];
  events: string[];
  cursor: { sent_at: string; email_id: string } | null;
  limit: number;
};

const CATEGORIES = new Set([
  "notificacoes",
  "ciclo_de_vida",
  "convites",
  "cobranca",
  "relatorios",
  "afiliados",
  "interno",
  "externo",
  "outros",
]);
const EVENTS = new Set([
  "sent",
  "delivery_delayed",
  "delivered",
  "failed",
  "suppressed",
  "canceled",
  "bounced",
  "complained",
]);
const TYPE_RE = /^[a-z0-9_]{1,64}$/;
// Kept as text end to end: Postgres' microsecond precision must reach the RPC untouched.
const CURSOR_TS_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}(:?\d{2})?|Z)$/;
const MAX_ITEMS = 50;

const json = (body: unknown, status: number, headers: Headers) =>
  new Response(JSON.stringify(body), { status, headers });

function strList(v: unknown, ok: (s: string) => boolean): string[] | null {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > MAX_ITEMS) return null;
  for (const s of v) if (typeof s !== "string" || !ok(s)) return null;
  return v as string[];
}

export function parseEmailListInput(body: unknown): EmailListInput | { error: string } {
  const range = parseEmailMetricsRange(body);
  if ("error" in range) return range;
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  const categories = strList(b.categories, (s) => CATEGORIES.has(s));
  const types = strList(b.types, (s) => TYPE_RE.test(s));
  const events = strList(b.events, (s) => EVENTS.has(s));
  if (!categories || !types || !events) return { error: "invalid_filter" };

  let cursor: EmailListInput["cursor"] = null;
  if (b.cursor !== undefined && b.cursor !== null) {
    const c = b.cursor as Record<string, unknown>;
    if (typeof c !== "object" || Array.isArray(c)) return { error: "invalid_cursor" };
    const { sent_at, email_id } = c;
    if (
      typeof sent_at !== "string" || !CURSOR_TS_RE.test(sent_at) ||
      typeof email_id !== "string" || email_id.length < 1 || email_id.length > 128
    ) return { error: "invalid_cursor" };
    cursor = { sent_at, email_id };
  }

  let limit = 50;
  if (b.limit !== undefined && b.limit !== null) {
    if (typeof b.limit !== "number" || !Number.isInteger(b.limit) || b.limit < 1 || b.limit > 100) {
      return { error: "invalid_limit" };
    }
    limit = b.limit;
  }

  return { ...range, categories, types, events, cursor, limit };
}

export async function handleEmailList(
  svc: SupabaseClient,
  body: unknown,
  headers: Headers,
): Promise<Response> {
  const input = parseEmailListInput(body);
  if ("error" in input) return json({ error: input.error }, 400, headers);
  const orNull = (a: string[]) => (a.length ? a : null);
  const { data, error } = await svc.rpc("email_sends_list", {
    p_start: input.start,
    p_end: input.end,
    p_categories: orNull(input.categories),
    p_types: orNull(input.types),
    p_events: orNull(input.events),
    p_cursor_sent_at: input.cursor?.sent_at ?? null,
    p_cursor_id: input.cursor?.email_id ?? null,
    p_limit: input.limit,
  });
  if (error || data == null) {
    console.error("[platform-admin] email-list: rpc failed");
    return json({ error: "Internal server error" }, 500, headers);
  }
  return json(data, 200, headers);
}
