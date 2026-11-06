// Admin "E-mails" backfill: pages through Resend's GET /emails (newest first) and inserts the
// rows it does not already have into email_sends (source 'backfill'). Idempotent: inserts ignore
// duplicates, so webhook rows (which carry the bounce reason) are never overwritten. The list has
// no tags and no bounce reason, so classification is by sender/subject and bounce_message is null.
// Cursor: `after=<last id>` continues down the list toward older e-mails (Resend docs, list-emails).
// Never logs payloads, recipients or the API key.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { classifyEmail, normalizeLastEvent, PII_EVENTS } from "../_shared/email-classify.ts";

type Headers = Record<string, string>;

export interface ResendListItem {
  id: string;
  from: string;
  subject: string;
  created_at: string;
  last_event: string;
  to: string[];
}

export interface EmailSendRow {
  email_id: string;
  category: string;
  type: string;
  sent_at: string;
  last_event: string;
  bounce_type: string | null;
  bounce_subtype: string | null;
  bounce_message: string | null;
  recipient: string | null;
  subject: string | null;
  source: "backfill";
}

export interface BackfillDeps {
  listPage: (cursor: string | null) => Promise<{ data: ResendListItem[]; has_more: boolean }>;
  insertRows: (rows: EmailSendRow[]) => Promise<number>;
  sleep: (ms: number) => Promise<void>;
}

const PAGE_LIMIT = 100;
const PAGE_DELAY_MS = 120;
const json = (body: unknown, status: number, headers: Headers) =>
  new Response(JSON.stringify(body), { status, headers });

function toRow(it: ResendListItem): EmailSendRow {
  const last = normalizeLastEvent(it.last_event);
  const { category, type } = classifyEmail({ from: it.from ?? "", subject: it.subject ?? "" });
  const pii = PII_EVENTS.has(last);
  return {
    email_id: it.id,
    category,
    type,
    sent_at: it.created_at,
    last_event: last,
    bounce_type: null,
    bounce_subtype: null,
    bounce_message: null,
    recipient: pii ? (Array.isArray(it.to) ? it.to[0] ?? null : null) : null,
    subject: pii ? (it.subject ?? null) : null,
    source: "backfill",
  };
}

export async function runEmailBackfill(
  cursor: string | null,
  deps: BackfillDeps,
  maxPages = 20,
): Promise<{ inserted: number; scanned: number; nextCursor: string | null; oldestReached: string | null; done: boolean }> {
  let inserted = 0;
  let scanned = 0;
  let next = cursor;
  let oldest: string | null = null;
  let done = false;
  for (let page = 0; page < maxPages; page++) {
    if (page > 0) await deps.sleep(PAGE_DELAY_MS);
    const res = await deps.listPage(next);
    const data = Array.isArray(res?.data) ? res.data : [];
    if (data.length > 0) {
      inserted += await deps.insertRows(data.map(toRow));
      scanned += data.length;
      next = data[data.length - 1].id;
      for (const it of data) {
        if (oldest === null || Date.parse(it.created_at) < Date.parse(oldest)) oldest = it.created_at;
      }
    }
    const more = typeof res?.has_more === "boolean" ? res.has_more : data.length >= PAGE_LIMIT;
    if (!more || data.length === 0) {
      done = true;
      break;
    }
  }
  return { inserted, scanned, nextCursor: next, oldestReached: oldest, done };
}

function resendListPage(apiKey: string, sleep: (ms: number) => Promise<void>): BackfillDeps["listPage"] {
  return async (cursor) => {
    const qs = new URLSearchParams({ limit: String(PAGE_LIMIT) });
    if (cursor) qs.set("after", cursor);
    const url = `https://api.resend.com/emails?${qs}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 429 && attempt === 0) {
        await res.body?.cancel();
        const wait = Number(res.headers.get("retry-after"));
        await sleep(Math.min(10_000, Number.isFinite(wait) && wait > 0 ? wait * 1000 : 1000));
        continue;
      }
      if (!res.ok) {
        await res.body?.cancel();
        throw new Error(`resend list failed: ${res.status}`);
      }
      return await res.json();
    }
    throw new Error("resend list failed: 429");
  };
}

export async function handleEmailBackfill(
  svc: SupabaseClient,
  body: unknown,
  headers: Headers,
): Promise<Response> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return json({ error: "resend_not_configured" }, 503, headers);
  const raw = (body && typeof body === "object" ? (body as Record<string, unknown>).cursor : null) ?? null;
  if (raw !== null && (typeof raw !== "string" || raw.length === 0 || raw.length > 100 || !/^[\w-]+$/.test(raw))) {
    return json({ error: "invalid_cursor" }, 400, headers);
  }
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const deps: BackfillDeps = {
    listPage: resendListPage(apiKey, sleep),
    insertRows: async (rows) => {
      const { data, error } = await svc
        .from("email_sends")
        .upsert(rows, { onConflict: "email_id", ignoreDuplicates: true })
        .select("email_id");
      if (error) throw new Error("insert failed");
      return data?.length ?? 0;
    },
    sleep,
  };
  try {
    const result = await runEmailBackfill(raw as string | null, deps);
    return json(result, 200, headers);
  } catch (e) {
    console.error("[platform-admin] email-backfill failed:", e instanceof Error ? e.message : "unknown");
    return json({ error: "backfill_failed" }, 502, headers);
  }
}
