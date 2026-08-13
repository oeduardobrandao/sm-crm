import { assert, assertEquals } from "./assert.ts";
import {
  createNotificationEmailCronHandler,
  type ClaimedNotificationRow,
  type NotificationEmailCronDeps,
  type NotificationEmailDb,
  runNotificationEmailCron,
} from "../notification-email-cron/handler.ts";
import type { DigestItem } from "../_shared/notification-email.ts";

const NOW = new Date("2026-08-13T12:00:00.000Z");

/** Fake db: one rpc (returns a preset claim set) + a from().update().in() reset
 * spy + auth.admin.getUserById. */
function makeFakeDb(
  claimReturn: ClaimedNotificationRow[],
  userEmails: Record<string, string | null | undefined>,
) {
  const resetCalls: string[][] = [];
  let rpcCalls = 0;
  const db = {
    resetCalls,
    rpcCallCount: () => rpcCalls,
    rpc(_fn: string, _args: unknown) {
      rpcCalls++;
      return Promise.resolve({ data: claimReturn, error: null });
    },
    from(_t: string) {
      return {
        update(_patch: { emailed_at: null }) {
          return { in(_c: string, ids: string[]) { resetCalls.push(ids); return Promise.resolve({ error: null }); } };
        },
      };
    },
    auth: { admin: { getUserById(id: string) {
      return Promise.resolve(
        id in userEmails
          ? { data: { user: { email: userEmails[id] ?? null } }, error: null }
          : { data: { user: null }, error: { message: "not found" } },
      );
    } } },
  };
  return db;
}

function claimed(over: Partial<ClaimedNotificationRow> & { id: string; user_id: string }): ClaimedNotificationRow {
  return { type: "mention", metadata: { actor_name: "Ana", context_title: "Post" }, link: "/x", created_at: "2026-08-13T11:00:00.000Z", ...over };
}

function makeDeps(db: ReturnType<typeof makeFakeDb>, over?: Partial<NotificationEmailCronDeps>) {
  const sent: Array<{ to: string; items: DigestItem[] }> = [];
  const deps: NotificationEmailCronDeps = {
    db: db as unknown as NotificationEmailDb,
    now: () => NOW,
    resendEnabled: true,
    sendDigest: (p) => { sent.push({ to: p.to, items: p.items }); return Promise.resolve({ skipped: false }); },
    ...over,
  };
  return { deps, sent };
}

Deno.test("RESEND unset: skipped, rpc never called", async () => {
  const db = makeFakeDb([claimed({ id: "1", user_id: "u1" })], { u1: "a@x.test" });
  const { deps, sent } = makeDeps(db, { resendEnabled: false });
  const r = await runNotificationEmailCron(deps);
  assertEquals(r, { claimed: 0, emailed: 0, failed: 0, released: 0, skipped: true });
  assertEquals(db.rpcCallCount(), 0);
  assertEquals(sent.length, 0);
});

Deno.test("one send per user, items ordered by urgency (publish failure first, mention last)", async () => {
  const db = makeFakeDb([
    claimed({ id: "1", user_id: "u1", type: "mention", metadata: { actor_name: "Ana", context_title: "P" } }),
    claimed({ id: "2", user_id: "u1", type: "post_publish_failed", metadata: { publish_error_code: "NO_MEDIA" } }),
    claimed({ id: "3", user_id: "u2", type: "task_assigned", metadata: { task_title: "T" } }),
  ], { u1: "a@x.test", u2: "b@x.test" });
  const { deps, sent } = makeDeps(db);
  const r = await runNotificationEmailCron(deps);
  assertEquals(r.claimed, 3);
  assertEquals(r.emailed, 2);
  assertEquals(sent.length, 2);
  const u1 = sent.find((s) => s.to === "a@x.test")!;
  assertEquals(u1.items.map((i) => i.priority), [1, 5]); // publish failure before mention
});

Deno.test("failed send resets that user's ids only", async () => {
  const db = makeFakeDb([
    claimed({ id: "1", user_id: "u1" }),
    claimed({ id: "2", user_id: "u2" }),
  ], { u1: "a@x.test", u2: "b@x.test" });
  const { deps } = makeDeps(db, {
    sendDigest: (p) => p.to === "b@x.test" ? Promise.reject(new Error("down")) : Promise.resolve({ skipped: false }),
  });
  const r = await runNotificationEmailCron(deps);
  assertEquals(r.emailed, 1);
  assertEquals(r.failed, 1);
  assertEquals(db.resetCalls, [["2"]]);
});

Deno.test("unresolved email is a failure and resets the claim", async () => {
  const db = makeFakeDb([claimed({ id: "1", user_id: "u1" })], { u1: null });
  const { deps, sent } = makeDeps(db);
  const r = await runNotificationEmailCron(deps);
  assertEquals(r.emailed, 0);
  assertEquals(r.failed, 1);
  assertEquals(sent.length, 0);
  assertEquals(db.resetCalls, [["1"]]);
});

Deno.test("deadline mid-loop releases remaining users' ids", async () => {
  const db = makeFakeDb([
    claimed({ id: "1", user_id: "u1" }),
    claimed({ id: "2", user_id: "u2" }),
    claimed({ id: "3", user_id: "u3" }),
  ], { u1: "a@x.test", u2: "b@x.test", u3: "c@x.test" });
  let i = 0;
  const nowMs = () => [0, 0, 70_000][Math.min(i++, 2)];
  const { deps, sent } = makeDeps(db, { nowMs });
  const r = await runNotificationEmailCron(deps);
  assertEquals(r.emailed, 1);
  assertEquals(r.released, 2);
  assertEquals(sent.length, 1);
  assertEquals(db.resetCalls.length, 1);
  assertEquals(db.resetCalls[0].sort(), ["2", "3"]);
});

Deno.test("handler rejects a wrong cron secret with 401", async () => {
  const handler = createNotificationEmailCronHandler({
    cronSecret: "seg", timingSafeEqual: (a, b) => a === b, run: () => Promise.resolve(new Response("ok")),
  });
  const res = await handler(new Request("https://x.test/", { headers: { "x-cron-secret": "no" } }));
  assertEquals(res.status, 401);
});
