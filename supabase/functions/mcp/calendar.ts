// deno-lint-ignore-file no-explicit-any
// Card `show_client_calendar`: the next weeks of a client's posts with gaps on the weekdays the
// client usually posts. Read-only. Spec: docs/superpowers/specs/2026-10-29-mcp-apps-cards-design.md §4.5.
import { z } from "npm:zod@3";
import { McpInputError } from "../_shared/mcp-token.ts";
import { cardToolMeta } from "./apps.ts";
import type { Deps } from "./queries.ts";
import { register } from "./register.ts";
import type { ToolMeta } from "./tool-meta.ts";

const TZ = "America/Sao_Paulo";
const DAY_MS = 86_400_000;
const DEFAULT_WEEKS = 3;
const MAX_WEEKS = 6;
/** How many weeks before `from` decide the client's usual weekdays. */
const HISTORY_WEEKS = 8;
/** A weekday is usual when it had a post in at least this many of those weeks. */
const USUAL_MIN_WEEKS = 4;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS_PT = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];

const wallClock = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** São Paulo wall-clock fields of an instant. */
function wallParts(ms: number): { y: number; m: number; d: number; h: number; mi: number; s: number } {
  const p: Record<string, number> = {};
  for (const part of wallClock.formatToParts(new Date(ms))) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  return { y: p.year, m: p.month, d: p.day, h: p.hour, mi: p.minute, s: p.second };
}

/** Offset (ms) of São Paulo from UTC at an instant, derived from Intl so it never assumes a fixed value. */
function offsetMsAt(ms: number): number {
  const w = wallParts(ms);
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s) - Math.floor(ms / 1000) * 1000;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** `YYYY-MM-DD` of an instant on the São Paulo calendar. */
function spDateOf(ms: number): string {
  const w = wallParts(ms);
  return `${w.y}-${pad(w.m)}-${pad(w.d)}`;
}

function isValidDate(date: string): boolean {
  if (!DATE_RE.test(date)) return false;
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

function dateMs(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function addDays(date: string, days: number): string {
  const t = new Date(dateMs(date) + days * DAY_MS);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** 0 = Monday .. 6 = Sunday. */
function weekdayOf(date: string): number {
  return (new Date(dateMs(date)).getUTCDay() + 6) % 7;
}

/** The instant São Paulo's `date` starts (00:00 local), as a UTC `Date`. */
export function saoPauloMidnightUtc(date: string): Date {
  const naive = dateMs(date); // the wall-clock reading taken as if it were UTC
  // Two passes settle on the right offset even when the guess lands across a DST change.
  let utc = naive - offsetMsAt(naive);
  utc = naive - offsetMsAt(utc);
  return new Date(utc);
}

/** Monday (`YYYY-MM-DD`) of the week containing `date`. */
export function mondayOf(date: string): string {
  return addDays(date, -weekdayOf(date));
}

/** Date a post sits on in the calendar: when it went out, else when it is scheduled. A published
 * post therefore never appears on both days (deliberately not the CRM grid, which uses
 * `scheduled_at` only: spec §4.5). */
export function canonicalDate(p: { published_at: string | null; scheduled_at: string | null }): string | null {
  return p.published_at ?? p.scheduled_at ?? null;
}

function instantMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** Weekdays (0 = Mon .. 6 = Sun) that had a post in at least 4 of the 8 weeks before `from`.
 * A weekday counts once per week however many posts it had that week. */
export function usualWeekdays(history: string[], from: string): number[] {
  const start = dateMs(addDays(from, -HISTORY_WEEKS * 7));
  const end = dateMs(from);
  const weeksByDay: Set<string>[] = Array.from({ length: 7 }, () => new Set<string>());
  for (const iso of history) {
    const ms = instantMs(iso);
    if (ms === null) continue;
    const day = spDateOf(ms);
    const t = dateMs(day);
    if (t < start || t >= end) continue;
    weeksByDay[weekdayOf(day)].add(mondayOf(day));
  }
  const out: number[] = [];
  for (let wd = 0; wd < 7; wd++) if (weeksByDay[wd].size >= USUAL_MIN_WEEKS) out.push(wd);
  return out;
}

export interface CalendarPost {
  id: number;
  titulo: string;
  tipo: string | null;
  status: string;
}

export interface CalendarDay {
  date: string;
  posts: CalendarPost[];
  gap: boolean;
}

export interface CalendarData {
  card: "client_calendar";
  v: 1;
  client: { id: number; nome: string };
  from: string;
  weeks: number;
  days: CalendarDay[];
  usual_weekdays: number[];
  open_url: string;
}

export async function listClientCalendar(
  d: Deps,
  a: { client_id: number; from?: string; weeks?: number },
): Promise<CalendarData> {
  const weeks = a.weeks ?? DEFAULT_WEEKS;
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > MAX_WEEKS) {
    throw new McpInputError(`Informe de 1 a ${MAX_WEEKS} semanas.`);
  }
  if (a.from !== undefined && !isValidDate(a.from)) {
    throw new McpInputError("Data inválida. Use o formato AAAA-MM-DD.");
  }
  const today = spDateOf(new Date(d.now?.() ?? new Date().toISOString()).getTime());
  const from = mondayOf(a.from ?? today);

  const { data: client } = await d.db
    .from("clientes")
    .select("id, nome")
    .eq("conta_id", d.ctx.conta_id)
    .eq("id", a.client_id)
    .maybeSingle();
  if (!client) throw new McpInputError("Cliente não encontrado neste workspace.");

  const rangeStart = saoPauloMidnightUtc(from);
  const rangeEnd = saoPauloMidnightUtc(addDays(from, weeks * 7));
  const historyStart = saoPauloMidnightUtc(addDays(from, -HISTORY_WEEKS * 7));
  const lo = historyStart.toISOString();
  const hi = rangeEnd.toISOString();

  // One query for the history and the range. The filter is a superset (either date inside the
  // window); the canonical date decides the real membership below.
  const { data } = await d.db
    .from("workflow_posts")
    .select("id, titulo, tipo, status, scheduled_at, published_at")
    .eq("conta_id", d.ctx.conta_id)
    .eq("cliente_id", a.client_id)
    .or(`and(scheduled_at.gte.${lo},scheduled_at.lt.${hi}),and(published_at.gte.${lo},published_at.lt.${hi})`);

  const dated: Array<{ row: any; ms: number; iso: string }> = [];
  for (const row of (data ?? []) as any[]) {
    const iso = canonicalDate(row);
    const ms = instantMs(iso);
    if (iso === null || ms === null) continue;
    if (ms < historyStart.getTime() || ms >= rangeEnd.getTime()) continue;
    dated.push({ row, ms, iso });
  }

  const usual = usualWeekdays(dated.map((p) => p.iso), from);

  const byDay = new Map<string, Array<{ row: any; ms: number }>>();
  for (const p of dated) {
    if (p.ms < rangeStart.getTime()) continue;
    const day = spDateOf(p.ms);
    const list = byDay.get(day) ?? [];
    list.push(p);
    byDay.set(day, list);
  }

  const days: CalendarDay[] = [];
  for (let i = 0; i < weeks * 7; i++) {
    const date = addDays(from, i);
    const posts = (byDay.get(date) ?? [])
      .sort((x, y) => x.ms - y.ms)
      .map(({ row }) => ({ id: row.id, titulo: row.titulo ?? "", tipo: row.tipo ?? null, status: row.status }));
    days.push({ date, posts, gap: posts.length === 0 && usual.includes(weekdayOf(date)) });
  }

  return {
    card: "client_calendar",
    v: 1,
    client: { id: client.id, nome: client.nome },
    from,
    weeks,
    days,
    usual_weekdays: usual,
    open_url: `https://www.mesaas.com.br/entregas?view=calendar&clientes=${client.id}`,
  };
}

function shortDate(date: string): string {
  const [, m, d] = date.split("-");
  return `${WEEKDAYS_PT[weekdayOf(date)]} ${d}/${m}`;
}

function summarize(c: CalendarData): string {
  const total = c.days.reduce((n, day) => n + day.posts.length, 0);
  const last = c.days[c.days.length - 1].date;
  const gaps = c.days.filter((day) => day.gap).map((day) => shortDate(day.date));
  const head = `Calendário de ${c.client.nome}, de ${shortDate(c.from)} a ${shortDate(last)}: ` +
    `${total} ${total === 1 ? "post" : "posts"}.`;
  if (c.usual_weekdays.length === 0) return `${head} Ainda não há histórico para apontar os dias de costume.`;
  return gaps.length === 0 ? `${head} Nenhum dia de costume está sem post.` : `${head} Dias de costume sem post: ${gaps.join(", ")}.`;
}

export function registerCalendarTools(server: any, deps: Deps): void {
  register(
    server,
    deps,
    "show_client_calendar",
    "posts:read",
    "Mostra ao usuário as próximas semanas de posts de um cliente, com os dias de costume sem post.",
    {
      client_id: z.number().int(),
      from: z.string().regex(DATE_RE).optional(),
      weeks: z.number().int().min(1).max(MAX_WEEKS).optional(),
    },
    async (a) => {
      const data = await listClientCalendar(deps, a);
      return { summary: summarize(data), data: data as unknown as Record<string, unknown> };
    },
    (a, data) => ({ client_id: a.client_id, from: data.from, weeks: data.weeks }),
    { card: true, meta: cardToolMeta() },
  );
}

export const CALENDAR_TOOL_META: Record<string, ToolMeta> = {
  show_client_calendar: { title: "Mostrar calendário do cliente", readOnly: true },
};
