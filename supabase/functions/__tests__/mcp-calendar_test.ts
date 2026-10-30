// deno-lint-ignore-file no-explicit-any
import { z } from "npm:zod@3";
import { assert, assertEquals } from "./assert.ts";
import { makeDeps } from "./mcp-financeiro-helpers.ts";
import { MCP_ALLOWED_SCOPES } from "../_shared/mcp-token.ts";
import {
  CALENDAR_TOOL_META,
  canonicalDate,
  listClientCalendar,
  mondayOf,
  registerCalendarTools,
  saoPauloMidnightUtc,
  usualWeekdays,
} from "../mcp/calendar.ts";
import { registerTools } from "../mcp/tools.ts";

type Post = { id: number; titulo: string | null; tipo: string | null; status: string; scheduled_at: string | null; published_at: string | null };
type Call = { table: string; method: string; args: unknown[] };

/** Fake db: `clientes` answers maybeSingle, `workflow_posts` answers the awaited chain with every
 * row it holds (the real filter is a superset, the card re-filters on the canonical date). */
function makeDb(client: { id: number; nome: string } | null, posts: Post[]) {
  const calls: Call[] = [];
  function rec(table: string) {
    const r: any = {};
    for (const m of ["select", "eq", "or", "gte", "lt", "order", "limit"]) {
      r[m] = (...args: unknown[]) => { calls.push({ table, method: m, args }); return r; };
    }
    r.maybeSingle = () => Promise.resolve({ data: table === "clientes" ? client : null, error: null });
    r.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve(resolve({ data: table === "workflow_posts" ? posts : [], error: null }));
    return r;
  }
  return { db: { from: (t: string) => { calls.push({ table: t, method: "from", args: [t] }); return rec(t); } }, calls };
}

function post(id: number, over: Partial<Post>): Post {
  return { id, titulo: `P${id}`, tipo: "feed", status: "agendado", scheduled_at: null, published_at: null, ...over };
}

const CLIENT = { id: 5, nome: "Clínica Aurora" };
const depsFor = (posts: Post[], client: typeof CLIENT | null = CLIENT) => {
  const { db, calls } = makeDb(client, posts);
  return { deps: makeDeps(db, { scopes: [...MCP_ALLOWED_SCOPES], role: "owner" }), calls };
};

/** Recording fake server that runs zod before the handler, like the SDK. */
function zodServer() {
  const tools: Record<string, { config: any; cb: (a: any) => Promise<any> }> = {};
  return {
    tools,
    registerTool(name: string, config: any, cb: any) {
      const schema = z.object(config.inputSchema);
      tools[name] = {
        config,
        cb: (args: any) => {
          const parsed = schema.safeParse(args);
          if (!parsed.success) return Promise.resolve({ isError: true, zod: parsed.error });
          return cb(parsed.data);
        },
      };
    },
    registerResource() {},
  };
}

Deno.test("saoPauloMidnightUtc / mondayOf", () => {
  assertEquals(saoPauloMidnightUtc("2026-11-02").toISOString(), "2026-11-02T03:00:00.000Z");
  assertEquals(mondayOf("2026-11-05"), "2026-11-02");
  assertEquals(mondayOf("2026-11-02"), "2026-11-02");
  assertEquals(mondayOf("2026-11-08"), "2026-11-02"); // Sunday belongs to the week that began Monday
  assertEquals(mondayOf("2026-12-31"), "2026-12-28"); // across a month/year edge
});

Deno.test("saoPauloMidnightUtc follows the zone's real offset on historical DST days", () => {
  // Brazil observed DST until 2019: UTC-2 in January, UTC-3 in July.
  assertEquals(saoPauloMidnightUtc("2018-01-15").toISOString(), "2018-01-15T02:00:00.000Z");
  assertEquals(saoPauloMidnightUtc("2018-07-15").toISOString(), "2018-07-15T03:00:00.000Z");
  // The day DST began (2018-11-04 00:00 skipped to 01:00): midnight does not exist, offset still resolves.
  assertEquals(saoPauloMidnightUtc("2018-11-05").toISOString(), "2018-11-05T02:00:00.000Z");
});

Deno.test("canonicalDate: published_at wins, else scheduled_at, else null", () => {
  assertEquals(canonicalDate({ published_at: "P", scheduled_at: "S" }), "P");
  assertEquals(canonicalDate({ published_at: null, scheduled_at: "S" }), "S");
  assertEquals(canonicalDate({ published_at: null, scheduled_at: null }), null);
});

Deno.test("range is [Mon 00:00 SP, +7·weeks)", async () => {
  const posts = [
    post(1, { scheduled_at: "2026-11-02T02:59:00Z" }), // Sunday 23:59 SP: before
    post(2, { scheduled_at: "2026-11-02T03:00:00Z" }), // Monday 00:00 SP: in
    post(3, { scheduled_at: "2026-11-23T02:59:00Z" }), // Sunday 23:59 SP of week 3: in
    post(4, { scheduled_at: "2026-11-23T03:00:00Z" }), // Monday 00:00 SP after the range: out
  ];
  const { deps, calls } = depsFor(posts);
  const out = await listClientCalendar(deps, { client_id: 5, from: "2026-11-02", weeks: 3 });
  const ids = out.days.flatMap((d) => d.posts.map((p) => p.id));
  assertEquals(ids, [2, 3]);
  assertEquals(out.days.length, 21);
  assertEquals(out.days[0].date, "2026-11-02");
  assertEquals(out.days[20].date, "2026-11-22");
  assertEquals(out.days[20].posts.map((p) => p.id), [3]);
  // Scoped by workspace and client, with one posts query bounded by the history start and range end.
  assert(calls.some((c) => c.table === "workflow_posts" && c.method === "eq" && JSON.stringify(c.args) === '["conta_id","workspace-A"]'));
  assert(calls.some((c) => c.table === "workflow_posts" && c.method === "eq" && JSON.stringify(c.args) === '["cliente_id",5]'));
  const or = calls.find((c) => c.table === "workflow_posts" && c.method === "or")!.args[0] as string;
  assert(or.includes("2026-09-07T03:00:00.000Z"), or); // 8 weeks before
  assert(or.includes("2026-11-23T03:00:00.000Z"), or);
  assertEquals(calls.filter((c) => c.table === "workflow_posts" && c.method === "from").length, 1);
});

Deno.test("post with both dates in range appears once, on published_at's day", async () => {
  const posts = [post(1, { scheduled_at: "2026-11-03T15:00:00Z", published_at: "2026-11-05T15:00:00Z", status: "postado" })];
  const { deps } = depsFor(posts);
  const out = await listClientCalendar(deps, { client_id: 5, from: "2026-11-02", weeks: 1 });
  const hits = out.days.filter((d) => d.posts.length > 0);
  assertEquals(hits.length, 1);
  assertEquals(hits[0].date, "2026-11-05");
});

Deno.test("published outside the range wins over a scheduled date inside it", async () => {
  const posts = [post(1, { scheduled_at: "2026-11-03T15:00:00Z", published_at: "2026-10-20T15:00:00Z", status: "postado" })];
  const { deps } = depsFor(posts);
  const out = await listClientCalendar(deps, { client_id: 5, from: "2026-11-02", weeks: 1 });
  assertEquals(out.days.flatMap((d) => d.posts).length, 0);
});

Deno.test("day bucket uses the São Paulo date, not the UTC one", async () => {
  // 2026-11-04T02:30Z is Tuesday 23:30 in São Paulo.
  const posts = [post(1, { scheduled_at: "2026-11-04T02:30:00Z" })];
  const { deps } = depsFor(posts);
  const out = await listClientCalendar(deps, { client_id: 5, from: "2026-11-02", weeks: 1 });
  assertEquals(out.days.find((d) => d.posts.length)!.date, "2026-11-03");
});

// Wednesdays (SP) of the eight weeks before 2026-11-02: Sep 9, 16, 23, 30, Oct 7, 14, 21, 28.
const WEDNESDAYS = ["2026-09-09", "2026-09-16", "2026-09-23", "2026-09-30", "2026-10-07", "2026-10-14", "2026-10-21", "2026-10-28"];
const at = (d: string) => `${d}T15:00:00Z`;

Deno.test("usualWeekdays: Wednesday in 4 of 8 weeks is usual; in 3 of 8 is not", () => {
  assertEquals(usualWeekdays(WEDNESDAYS.slice(0, 4).map(at), "2026-11-02"), [2]);
  assertEquals(usualWeekdays(WEDNESDAYS.slice(0, 3).map(at), "2026-11-02"), []);
});

Deno.test("usualWeekdays: a weekday counts once per week; outside the 8 weeks is ignored", () => {
  const sameWeek = ["2026-10-28T12:00:00Z", "2026-10-28T18:00:00Z", "2026-10-28T20:00:00Z", "2026-10-28T21:00:00Z"];
  assertEquals(usualWeekdays(sameWeek, "2026-11-02"), []);
  const old = ["2026-09-02", "2026-08-26", "2026-08-19", "2026-08-12"].map(at); // before the window
  assertEquals(usualWeekdays(old, "2026-11-02"), []);
  const inFrom = ["2026-11-04", "2026-11-11", "2026-11-18", "2026-11-25"].map(at); // at/after `from`
  assertEquals(usualWeekdays(inFrom, "2026-11-02"), []);
});

Deno.test("client with no history: usual_weekdays [] and no day has gap true", async () => {
  const { deps } = depsFor([post(1, { scheduled_at: at("2026-11-04") })]);
  const out = await listClientCalendar(deps, { client_id: 5, from: "2026-11-02", weeks: 2 });
  assertEquals(out.usual_weekdays, []);
  assert(out.days.every((d) => d.gap === false));
});

Deno.test("gap only on usual weekdays with no post", async () => {
  // History: Wednesdays in 4 weeks. Range week 1: post on Wed Nov 4; week 2: Wed Nov 11 empty, a post on Fri.
  const posts = [
    ...WEDNESDAYS.slice(0, 4).map((d, i) => post(10 + i, { published_at: at(d), status: "postado" })),
    post(1, { scheduled_at: at("2026-11-04") }),
    post(2, { scheduled_at: at("2026-11-13") }),
  ];
  const { deps } = depsFor(posts);
  const out = await listClientCalendar(deps, { client_id: 5, from: "2026-11-05", weeks: 2 }); // snapped to Mon 11-02
  assertEquals(out.from, "2026-11-02");
  assertEquals(out.usual_weekdays, [2]);
  assertEquals(out.days.filter((d) => d.gap).map((d) => d.date), ["2026-11-11"]);
  assertEquals(out.days.find((d) => d.date === "2026-11-04")!.gap, false); // usual but has a post
  assertEquals(out.days.find((d) => d.date === "2026-11-12")!.gap, false); // not a usual weekday
});

Deno.test("from defaults to today in São Paulo (injected clock), weeks to 3", async () => {
  const { deps } = depsFor([]);
  // 2026-11-05T01:00Z is still Wednesday Nov 4 in São Paulo -> Monday Nov 2.
  const out = await listClientCalendar({ ...deps, now: () => "2026-11-05T01:00:00Z" }, { client_id: 5 });
  assertEquals(out.from, "2026-11-02");
  assertEquals(out.weeks, 3);
  assertEquals(out.days.length, 21);
});

Deno.test("open_url and shape", async () => {
  const { deps } = depsFor([post(1, { scheduled_at: at("2026-11-04"), titulo: null, tipo: null })]);
  const out = await listClientCalendar(deps, { client_id: 5, from: "2026-11-02", weeks: 1 });
  assertEquals(out.open_url, "https://www.mesaas.com.br/entregas?view=calendar&clientes=5");
  assertEquals(out.card, "client_calendar");
  assertEquals(out.v, 1);
  assertEquals(out.client, { id: 5, nome: "Clínica Aurora" });
  assertEquals(out.days.find((d) => d.posts.length)!.posts[0], { id: 1, titulo: "", tipo: null, status: "agendado" });
});

Deno.test("client from another workspace -> not found", async () => {
  const { deps } = depsFor([], null);
  let msg = "";
  try {
    await listClientCalendar(deps, { client_id: 99, from: "2026-11-02" });
  } catch (e) {
    msg = (e as Error).message;
  }
  assertEquals(msg, "Cliente não encontrado neste workspace.");
});

Deno.test("invalid from / weeks are refused", async () => {
  const { deps } = depsFor([]);
  for (const a of [{ from: "2026-02-30" }, { from: "02/11/2026" }, { weeks: 0 }, { weeks: 7 }]) {
    let threw = false;
    try {
      await listClientCalendar(deps, { client_id: 5, ...a });
    } catch {
      threw = true;
    }
    assert(threw, JSON.stringify(a));
  }
});

Deno.test("show_client_calendar: registered as a card tool, zod limits, audit carries ids only", async () => {
  const { db, calls } = makeDb(CLIENT, [post(1, { scheduled_at: at("2026-11-04"), titulo: "Segredo do post" })]);
  const audits: any[] = [];
  const auditedDb = {
    ...db,
    from: (t: string) => (t === "audit_log"
      ? { insert: (row: any) => { audits.push(row); return Promise.resolve({ error: null }); } }
      : db.from(t)),
  };
  const deps = makeDeps(auditedDb, { scopes: ["posts:read"], role: "agent" });
  const server = zodServer();
  registerCalendarTools(server, deps);
  const tool = server.tools["show_client_calendar"];
  assertEquals(tool.config.title, CALENDAR_TOOL_META.show_client_calendar.title);
  assertEquals(tool.config.annotations.readOnlyHint, true);
  assertEquals(tool.config._meta.ui.resourceUri, "ui://mesaas/cards-v3.html");

  for (const bad of [{ client_id: 5, weeks: 0 }, { client_id: 5, weeks: 7 }, { client_id: 5, weeks: 1.5 }, { client_id: 5, from: "hoje" }, { client_id: "5" }, {}]) {
    const r = await tool.cb(bad);
    assert(r.zod, `zod should refuse ${JSON.stringify(bad)}`);
  }

  const res = await tool.cb({ client_id: 5, from: "2026-11-02", weeks: 1 });
  assertEquals(res.isError, undefined);
  assertEquals(res.structuredContent.card, "client_calendar");
  assertEquals(res.structuredContent.v, 1);
  assert(typeof res.content[0].text === "string" && res.content[0].text.includes("Clínica Aurora"));
  assert(!/—/.test(res.content[0].text), "no em dash");
  assert(calls.length > 0);
  assertEquals(audits.length, 1);
  const meta = audits[0].metadata;
  assertEquals(meta.args, { client_id: 5, from: "2026-11-02", weeks: 1 });
  assert(!JSON.stringify(audits[0]).includes("Segredo do post"));
});

Deno.test("show_client_calendar: scope posts:read required", async () => {
  const { db } = makeDb(CLIENT, []);
  const deps = makeDeps(db, { scopes: ["clientes:read"], role: "agent" });
  const server = zodServer();
  registerCalendarTools(server, deps);
  const res = await server.tools["show_client_calendar"].cb({ client_id: 5 });
  assertEquals(res.isError, true);
  assert(res.content[0].text.includes("posts:read"));
});

Deno.test("registerTools with apps on exposes show_client_calendar; off does not", () => {
  const { db } = makeDb(CLIENT, []);
  const base = makeDeps(db, { scopes: [...MCP_ALLOWED_SCOPES], role: "owner", key_id: "oauth:k" });
  for (const [apps, expected] of [[{ enabled: true, oauth: true, r2Origin: null }, true], [undefined, false]] as const) {
    const names: string[] = [];
    const server = { registerTool: (n: string) => names.push(n), registerResource() {} };
    registerTools(server as any, apps ? { ...base, apps } : base);
    assertEquals(names.includes("show_client_calendar"), expected);
  }
});
