import { assert, assertEquals } from "./assert.ts";
import {
  buildPushMessage,
  type ClaimedPushRow,
  createNotificationPushCronHandler,
  type NotificationPushCronDeps,
  type NotificationPushDb,
  type PushDeviceRow,
  runNotificationPushCron,
} from "../notification-push-cron/handler.ts";
import type { ApnsMessage, ApnsResult } from "../_shared/apns.ts";

const NOW = new Date("2026-10-15T12:00:00.000Z");

interface FakeDbOpts {
  claim: ClaimedPushRow[];
  devices?: PushDeviceRow[];
  badges?: Array<{ user_id: string; unread: number }>;
  claimError?: string;
  devicesError?: string;
  badgeError?: string;
}

function makeFakeDb(o: FakeDbOpts) {
  const calls = {
    claimArgs: [] as unknown[],
    badgeArgs: [] as unknown[],
    released: [] as string[][],
    disabled: [] as string[][],
    deviceFilter: null as null | { ids: string[]; platform: string },
  };
  const db = {
    calls,
    rpc(fn: string, args: unknown) {
      if (fn === "claim_notification_pushes") {
        calls.claimArgs.push(args);
        return Promise.resolve(o.claimError ? { data: null, error: { message: o.claimError } } : { data: o.claim, error: null });
      }
      calls.badgeArgs.push(args);
      return Promise.resolve(o.badgeError ? { data: null, error: { message: o.badgeError } } : { data: o.badges ?? [], error: null });
    },
    from(table: string) {
      if (table === "push_devices") {
        return {
          select(_c: string) {
            return {
              in(_col: string, ids: string[]) {
                return {
                  eq(_c2: string, platform: string) {
                    return {
                      is(_c3: string, _v: null) {
                        calls.deviceFilter = { ids, platform };
                        return Promise.resolve(
                          o.devicesError
                            ? { data: null, error: { message: o.devicesError } }
                            : { data: (o.devices ?? []).filter((d) => ids.includes(d.user_id)), error: null },
                        );
                      },
                    };
                  },
                };
              },
            };
          },
          update(_p: { disabled_at: string }) {
            return { in(_c: string, tokens: string[]) { calls.disabled.push(tokens); return Promise.resolve({ error: null }); } };
          },
        };
      }
      return {
        update(_p: { pushed_at: null }) {
          return { in(_c: string, ids: string[]) { calls.released.push(ids); return Promise.resolve({ error: null }); } };
        },
      };
    },
  };
  return db;
}

function row(over: Partial<ClaimedPushRow> & { id: string; user_id: string }): ClaimedPushRow {
  return {
    workspace_id: "w1",
    type: "post_correction",
    metadata: { client_name: "Clínica Sol", post_title: "Carrossel outubro", comentario: "Troca a foto" },
    link: "/entregas?post=1",
    created_at: "2026-10-15T11:59:00.000Z",
    ...over,
  };
}

function makeDeps(
  db: ReturnType<typeof makeFakeDb>,
  sendImpl: (token: string) => ApnsResult | Promise<ApnsResult> = () => ({ ok: true }),
  over?: Partial<NotificationPushCronDeps>,
) {
  const sent: Array<{ token: string; environment: string; message: ApnsMessage }> = [];
  const reports: unknown[] = [];
  const deps: NotificationPushCronDeps = {
    db: db as unknown as NotificationPushDb,
    send: async (token, environment, message) => {
      sent.push({ token, environment, message });
      return await sendImpl(token);
    },
    now: () => NOW,
    report: (d) => { reports.push(d); return Promise.resolve(); },
    ...over,
  };
  return { deps, sent, reports };
}

Deno.test("without APNs configured the run is skipped and claims nothing", async () => {
  const db = makeFakeDb({ claim: [row({ id: "n1", user_id: "u1" })] });
  const { deps } = makeDeps(db, undefined, { send: null });
  const res = await runNotificationPushCron(deps);
  assertEquals(res.skipped, true);
  assertEquals(db.calls.claimArgs.length, 0);
});

Deno.test("claims with a 15-minute window and a bounded batch", async () => {
  const db = makeFakeDb({ claim: [] });
  const { deps } = makeDeps(db);
  const res = await runNotificationPushCron(deps);
  assertEquals(db.calls.claimArgs[0], { p_after: "2026-10-15T11:45:00.000Z", p_limit: 200 });
  assertEquals(res, { claimed: 0, users: 0, sent: 0, failed: 0, disabled: 0, released: 0, skipped: false });
});

Deno.test("one row becomes one push with its own text, link, badge and every device of the user", async () => {
  const db = makeFakeDb({
    claim: [row({ id: "n1", user_id: "u1" })],
    devices: [
      { user_id: "u1", token: "tokA", environment: "production" },
      { user_id: "u1", token: "tokB", environment: "sandbox" },
    ],
    badges: [{ user_id: "u1", unread: 7 }],
  });
  const { deps, sent } = makeDeps(db);
  const res = await runNotificationPushCron(deps);
  assertEquals(db.calls.deviceFilter, { ids: ["u1"], platform: "ios" });
  assertEquals(sent.map((s) => [s.token, s.environment]), [["tokA", "production"], ["tokB", "sandbox"]]);
  assertEquals(sent[0].message, {
    alert: { title: "Correção solicitada pelo cliente", subtitle: "Clínica Sol · Carrossel outubro", body: "Troca a foto" },
    badge: 7,
    threadId: "post_correction",
    data: { link: "/entregas?post=1", notification_id: "n1" },
  });
  assertEquals(res.sent, 2);
  assertEquals(res.users, 1);
});

Deno.test("several rows for one user become a single summary push", async () => {
  const db = makeFakeDb({
    claim: [
      row({ id: "n1", user_id: "u1", type: "post_approved", metadata: { client_name: "A", post_title: "P" } }),
      row({ id: "n2", user_id: "u1" }),
      row({ id: "n3", user_id: "u2" }),
    ],
    devices: [
      { user_id: "u1", token: "t1", environment: "production" },
      { user_id: "u2", token: "t2", environment: "production" },
    ],
  });
  const { deps, sent } = makeDeps(db);
  await runNotificationPushCron(deps);
  assertEquals(sent.length, 2);
  const u1 = sent.find((s) => s.token === "t1")!.message;
  assertEquals(u1.alert.title, "2 novas notificações no Mesaas");
  // Urgency order: the correction (priority 2) comes before the approval (6).
  assertEquals(u1.alert.body, "Correção solicitada pelo cliente, Post aprovado pelo cliente.");
  assertEquals(u1.data, { link: null, notification_id: null });
});

Deno.test("dead tokens are disabled and not counted as failures", async () => {
  const db = makeFakeDb({
    claim: [row({ id: "n1", user_id: "u1" })],
    devices: [
      { user_id: "u1", token: "dead", environment: "production" },
      { user_id: "u1", token: "live", environment: "production" },
    ],
  });
  const { deps, reports } = makeDeps(db, (t) =>
    t === "dead" ? { ok: false, status: 410, reason: "Unregistered", unregistered: true } : { ok: true });
  const res = await runNotificationPushCron(deps);
  assertEquals(db.calls.disabled, [["dead"]]);
  assertEquals([res.sent, res.failed, res.disabled], [1, 0, 1]);
  assertEquals(reports.length, 0);
});

Deno.test("other send errors and throws are reported, not retried, and other users still get theirs", async () => {
  const db = makeFakeDb({
    claim: [row({ id: "n1", user_id: "u1" }), row({ id: "n2", user_id: "u2" }), row({ id: "n3", user_id: "u3" })],
    devices: [
      { user_id: "u1", token: "t1", environment: "production" },
      { user_id: "u2", token: "t2", environment: "production" },
      { user_id: "u3", token: "t3", environment: "production" },
    ],
  });
  const { deps, reports } = makeDeps(db, (t) => {
    if (t === "t1") return { ok: false, status: 429, reason: "TooManyRequests", unregistered: false };
    if (t === "t2") throw new Error("connection reset");
    return { ok: true };
  });
  const res = await runNotificationPushCron(deps);
  assertEquals([res.sent, res.failed], [1, 2]);
  assertEquals(db.calls.released.length, 0, "failed sends are not released for retry");
  assertEquals(reports, [{
    failed: 2,
    errors: [{ accountId: "u1", error: "429 TooManyRequests" }, { accountId: "u2", error: "connection reset" }],
  }]);
});

Deno.test("a badge-count failure still sends, without a badge", async () => {
  const db = makeFakeDb({
    claim: [row({ id: "n1", user_id: "u1" })],
    devices: [{ user_id: "u1", token: "t1", environment: "production" }],
    badgeError: "boom",
  });
  const { deps, sent } = makeDeps(db);
  await runNotificationPushCron(deps);
  assertEquals(sent.length, 1);
  assertEquals(sent[0].message.badge, undefined);
});

Deno.test("a device read failure releases every claim and throws", async () => {
  const db = makeFakeDb({ claim: [row({ id: "n1", user_id: "u1" }), row({ id: "n2", user_id: "u2" })], devicesError: "timeout" });
  const { deps } = makeDeps(db);
  let threw = false;
  try { await runNotificationPushCron(deps); } catch { threw = true; }
  assert(threw, "should throw");
  assertEquals(db.calls.released, [["n1", "n2"]]);
});

Deno.test("past the soft deadline the remaining users' claims are released", async () => {
  const db = makeFakeDb({
    claim: [row({ id: "n1", user_id: "u1" }), row({ id: "n2", user_id: "u2" }), row({ id: "n3", user_id: "u2" })],
    devices: [
      { user_id: "u1", token: "t1", environment: "production" },
      { user_id: "u2", token: "t2", environment: "production" },
    ],
  });
  let clock = 0;
  const { deps, sent } = makeDeps(db, () => { clock += 41_000; return { ok: true }; }, { nowMs: () => clock });
  const res = await runNotificationPushCron(deps);
  assertEquals(sent.map((s) => s.token), ["t1"]);
  assertEquals(db.calls.released, [["n2", "n3"]]);
  assertEquals(res.released, 2);
});

Deno.test("buildPushMessage clamps long bodies and names the extra count in summaries", () => {
  const long = "x".repeat(400);
  const one = buildPushMessage([row({ id: "n1", user_id: "u1", metadata: { comentario: long } })], undefined);
  assert(one.alert.body!.length <= 181, "clamped to 180 + ellipsis");
  const many = buildPushMessage(
    ["a", "b", "c", "d", "e"].map((id) => row({ id, user_id: "u1" })),
    2,
  );
  assertEquals(many.alert.title, "5 novas notificações no Mesaas");
  assert(many.alert.body!.endsWith("e mais 2."), many.alert.body!);
});

Deno.test("the auth wrapper rejects a missing or wrong cron secret before running", async () => {
  let ran = false;
  const handler = createNotificationPushCronHandler({
    cronSecret: "s3cret",
    timingSafeEqual: (a, b) => a === b,
    run: () => { ran = true; return Promise.resolve(new Response("ok")); },
  });
  const bad = await handler(new Request("http://x", { method: "POST", headers: { "x-cron-secret": "nope" } }));
  assertEquals(bad.status, 401);
  assertEquals(ran, false);
  const good = await handler(new Request("http://x", { method: "POST", headers: { "x-cron-secret": "s3cret" } }));
  assertEquals(good.status, 200);
});
