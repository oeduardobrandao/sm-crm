import { assert, assertEquals } from "./assert.ts";
import { handleEmailList, parseEmailListInput } from "../platform-admin/email-list.ts";

const base = { start: "2026-11-01", end: "2026-11-07" };

Deno.test("list input: minimal body gets defaults", () => {
  assertEquals(parseEmailListInput(base), {
    ...base,
    categories: [],
    types: [],
    events: [],
    cursor: null,
    limit: 50,
  });
});

Deno.test("list input: filters validated", () => {
  assertEquals(parseEmailListInput({ ...base, categories: ["nope"] }), { error: "invalid_filter" });
  assertEquals(parseEmailListInput({ ...base, categories: "externo" }), { error: "invalid_filter" });
  assert(!("error" in parseEmailListInput({ ...base, categories: ["externo", "outros"] })));
  const ok = parseEmailListInput({ ...base, types: ["desconhecido", "nurture_a3_b1"] });
  assert(!("error" in ok));
  assertEquals(parseEmailListInput({ ...base, types: ["Bad Type"] }), { error: "invalid_filter" });
  assertEquals(parseEmailListInput({ ...base, events: ["opened"] }), { error: "invalid_filter" });
  assert(!("error" in parseEmailListInput({ ...base, events: ["delivered", "delivery_delayed"] })));
  const many = Array.from({ length: 51 }, () => "outros");
  assertEquals(parseEmailListInput({ ...base, categories: many }), { error: "invalid_filter" });
});

Deno.test("list input: cursor", () => {
  assertEquals(parseEmailListInput({ ...base, cursor: { sent_at: "2026-11-01T12:00:00Z" } }), {
    error: "invalid_cursor",
  });
  assertEquals(parseEmailListInput({ ...base, cursor: { sent_at: "garbage", email_id: "x" } }), {
    error: "invalid_cursor",
  });
  assertEquals(parseEmailListInput({ ...base, cursor: { sent_at: "2026-11-01T12:00:00Z", email_id: "" } }), {
    error: "invalid_cursor",
  });
  const sentAt = "2026-11-01T12:00:00.123456+00:00";
  const r = parseEmailListInput({ ...base, cursor: { sent_at: sentAt, email_id: "abc" } });
  assert(!("error" in r));
  if (!("error" in r)) assertEquals(r.cursor, { sent_at: sentAt, email_id: "abc" });
});

Deno.test("list input: limit and range", () => {
  assertEquals(parseEmailListInput({ ...base, limit: 0 }), { error: "invalid_limit" });
  assertEquals(parseEmailListInput({ ...base, limit: 101 }), { error: "invalid_limit" });
  assertEquals(parseEmailListInput({ ...base, limit: 100 }), {
    ...base,
    categories: [],
    types: [],
    events: [],
    cursor: null,
    limit: 100,
  });
  assertEquals(parseEmailListInput({ start: "2026-11-07", end: "2026-11-01" }), { error: "invalid_range" });
});

const H = { "Content-Type": "application/json" };

Deno.test("handle: 400 on invalid input, no rpc call", async () => {
  let called = false;
  // deno-lint-ignore no-explicit-any
  const svc: any = { rpc: () => { called = true; return Promise.resolve({ data: {}, error: null }); } };
  const res = await handleEmailList(svc, { ...base, limit: 0 }, H);
  assertEquals(res.status, 400);
  assertEquals(await res.json(), { error: "invalid_limit" });
  assertEquals(called, false);
});

Deno.test("handle: empty arrays go to rpc as null, result passed through", async () => {
  let args: Record<string, unknown> = {};
  // deno-lint-ignore no-explicit-any
  const svc: any = {
    rpc: (_n: string, a: Record<string, unknown>) => {
      args = a;
      return Promise.resolve({ data: { items: [], next_cursor: null, types: [] }, error: null });
    },
  };
  const res = await handleEmailList(svc, { ...base, events: ["bounced"] }, H);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { items: [], next_cursor: null, types: [] });
  assertEquals(args, {
    p_start: base.start,
    p_end: base.end,
    p_categories: null,
    p_types: null,
    p_events: ["bounced"],
    p_cursor_sent_at: null,
    p_cursor_id: null,
    p_limit: 50,
  });
});

Deno.test("handle: rpc error is generic 500 and not logged raw", async () => {
  const logged: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => logged.push(a.join(" "));
  try {
    // deno-lint-ignore no-explicit-any
    const svc: any = { rpc: () => Promise.resolve({ data: null, error: { message: "SECRET_SQL_VALUE" } }) };
    const res = await handleEmailList(svc, base, H);
    assertEquals(res.status, 500);
    assertEquals(await res.json(), { error: "Internal server error" });
  } finally {
    console.error = orig;
  }
  assert(logged.length > 0);
  assert(!logged.join("\n").includes("SECRET_SQL_VALUE"));
});

Deno.test("handle: cursor goes to rpc byte-identical", async () => {
  let args: Record<string, unknown> = {};
  // deno-lint-ignore no-explicit-any
  const svc: any = {
    rpc: (_n: string, a: Record<string, unknown>) => {
      args = a;
      return Promise.resolve({ data: { items: [], next_cursor: null, types: [] }, error: null });
    },
  };
  const sentAt = "2026-11-01T12:00:00.123456+00:00";
  const res = await handleEmailList(svc, { ...base, cursor: { sent_at: sentAt, email_id: "em_1" } }, H);
  assertEquals(res.status, 200);
  assert(args.p_cursor_sent_at === sentAt);
  assertEquals(args.p_cursor_id, "em_1");
});
