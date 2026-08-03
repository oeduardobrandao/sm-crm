import { assert, assertEquals } from "./assert.ts";
import {
  createMentionEmailCronHandler,
  type MentionEmailCronDeps,
  type MentionEmailDb,
  type MentionEmailItem,
  runMentionEmailCron,
} from "../mention-email-cron/handler.ts";

/**
 * Fake of the three supabase-js surfaces the handler touches:
 *  - .from("notifications").select(cols).eq/.is/.lte/.gte/.order/.limit() —
 *    step 1, the read-only eligibility query (bounded + ordered, claims
 *    nothing).
 *  - .from("notifications").update(patch).in/.is...select() — step 2, the
 *    claim (patch.emailed_at = ISO string, filtered by .in("id", ids) AND
 *    .is("emailed_at", null)) and the per-user reset (patch.emailed_at =
 *    null, filtered by .in("id", ids) only, no .select()).
 *  - auth.admin.getUserById(userId) — email resolution.
 *
 * Both the eligibility query and the claim actually APPLY their recorded
 * filters against the in-memory rows (not just record that they were called)
 * so the tests prove the filters — including the step-2 emailed_at IS NULL
 * re-check — are both present AND correct.
 */
interface FakeNotification {
  id: number;
  type: string;
  user_id: string;
  metadata: Record<string, unknown> | null;
  link: string | null;
  read_at: string | null;
  dismissed_at: string | null;
  emailed_at: string | null;
  created_at: string;
}

function makeFakeDb(
  rows: FakeNotification[],
  userEmails: Record<string, string | null | undefined>,
) {
  const eligibleCalls: Array<{
    eq: Record<string, string>;
    is: Record<string, null>;
    lte: Record<string, string>;
    gte: Record<string, string>;
    limit: number | undefined;
  }> = [];
  const claimCalls: Array<{ in: number[]; is: Record<string, null> }> = [];
  const resetCalls: number[][] = [];
  let updateCalled = false;

  const db = {
    rows,
    eligibleCalls,
    claimCalls,
    resetCalls,
    updateWasCalled: () => updateCalled,
    from(table: string) {
      assert(table === "notifications", `unexpected table ${table}`);
      return {
        select(_cols: string) {
          const filters = {
            eq: {} as Record<string, string>,
            is: {} as Record<string, null>,
            lte: {} as Record<string, string>,
            gte: {} as Record<string, string>,
            order: undefined as { column: string; ascending: boolean } | undefined,
            limit: undefined as number | undefined,
          };
          const run = () => {
            eligibleCalls.push({
              eq: filters.eq,
              is: filters.is,
              lte: filters.lte,
              gte: filters.gte,
              limit: filters.limit,
            });
            let matched = rows.filter((r) => {
              for (const [col, val] of Object.entries(filters.eq)) {
                if ((r as unknown as Record<string, unknown>)[col] !== val) return false;
              }
              for (const col of Object.keys(filters.is)) {
                if ((r as unknown as Record<string, unknown>)[col] !== null) return false;
              }
              for (const [col, val] of Object.entries(filters.lte)) {
                if (!(String((r as unknown as Record<string, unknown>)[col]) <= val)) return false;
              }
              for (const [col, val] of Object.entries(filters.gte)) {
                if (!(String((r as unknown as Record<string, unknown>)[col]) >= val)) return false;
              }
              return true;
            });
            if (filters.order) {
              const { column, ascending } = filters.order;
              matched = [...matched].sort((a, b) => {
                const av = String((a as unknown as Record<string, unknown>)[column]);
                const bv = String((b as unknown as Record<string, unknown>)[column]);
                return ascending ? (av < bv ? -1 : av > bv ? 1 : 0) : av < bv ? 1 : av > bv ? -1 : 0;
              });
            }
            if (filters.limit !== undefined) {
              matched = matched.slice(0, filters.limit);
            }
            return Promise.resolve({
              data: matched.map((r) => ({ id: r.id, created_at: r.created_at })),
              error: null,
            });
          };
          // deno-lint-ignore no-explicit-any
          const chain: any = {
            eq(col: string, val: string) {
              filters.eq[col] = val;
              return chain;
            },
            is(col: string, val: null) {
              filters.is[col] = val;
              return chain;
            },
            lte(col: string, val: string) {
              filters.lte[col] = val;
              return chain;
            },
            gte(col: string, val: string) {
              filters.gte[col] = val;
              return chain;
            },
            order(col: string, opts: { ascending: boolean }) {
              filters.order = { column: col, ascending: opts.ascending };
              return chain;
            },
            limit(n: number) {
              filters.limit = n;
              return chain;
            },
            then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
              return run().then(resolve, reject);
            },
          };
          return chain;
        },
        update(patch: { emailed_at: string | null }) {
          updateCalled = true;
          const filters = {
            is: {} as Record<string, null>,
            in: undefined as number[] | undefined,
          };
          const applyClaim = () => {
            claimCalls.push({ in: filters.in ?? [], is: filters.is });
            const idSet = new Set(filters.in ?? []);
            const matched = rows.filter((r) => {
              if (!idSet.has(r.id)) return false;
              for (const col of Object.keys(filters.is)) {
                if ((r as unknown as Record<string, unknown>)[col] !== null) return false;
              }
              return true;
            });
            for (const r of matched) r.emailed_at = patch.emailed_at as string;
            return Promise.resolve({
              data: matched.map((r) => ({
                id: r.id,
                user_id: r.user_id,
                metadata: r.metadata,
                link: r.link,
                created_at: r.created_at,
              })),
              error: null,
            });
          };
          const applyReset = () => {
            const ids = filters.in ?? [];
            resetCalls.push(ids);
            for (const r of rows) {
              if (ids.includes(r.id)) r.emailed_at = null;
            }
            return Promise.resolve({ data: null, error: null });
          };
          // deno-lint-ignore no-explicit-any
          const chain: any = {
            is(col: string, val: null) {
              filters.is[col] = val;
              return chain;
            },
            in(col: string, vals: number[]) {
              assert(col === "id", `unexpected .in() column ${col}`);
              filters.in = vals;
              return chain;
            },
            select(_cols: string) {
              return applyClaim();
            },
            // Reset path: awaited directly after .in(), no .select().
            then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
              return (patch.emailed_at === null ? applyReset() : applyClaim()).then(
                resolve,
                reject,
              );
            },
          };
          return chain;
        },
      };
    },
    auth: {
      admin: {
        getUserById(userId: string) {
          if (!(userId in userEmails)) {
            return Promise.resolve({
              data: { user: null },
              error: { message: "not found" },
            });
          }
          return Promise.resolve({
            data: { user: { email: userEmails[userId] ?? null } },
            error: null,
          });
        },
      },
    },
  };
  return db;
}

const NOW = new Date("2026-08-03T12:00:00.000Z");
const CLAIM_BEFORE = "2026-08-03T11:50:00.000Z"; // now - 10min
const CLAIM_AFTER = "2026-08-02T12:00:00.000Z"; // now - 24h

function row(overrides: Partial<FakeNotification> & { id: number }): FakeNotification {
  return {
    type: "mention",
    user_id: "u1",
    metadata: { actor_name: "Ana", context_title: "Post de lançamento", excerpt: "@Ana veja isso" },
    link: "/entregas?drawer=12",
    read_at: null,
    dismissed_at: null,
    emailed_at: null,
    created_at: "2026-08-03T11:00:00.000Z", // 1h ago: within window
    ...overrides,
  };
}

function makeDeps(
  db: ReturnType<typeof makeFakeDb>,
  overrides?: Partial<MentionEmailCronDeps>,
) {
  const sent: Array<{ to: string; mentions: MentionEmailItem[] }> = [];
  const deps: MentionEmailCronDeps = {
    db: db as unknown as MentionEmailDb,
    now: () => NOW,
    resendEnabled: true,
    sendMentionEmail: (p) => {
      sent.push(p);
      return Promise.resolve({ skipped: false });
    },
    ...overrides,
  };
  return { deps, sent };
}

Deno.test("mention-email-cron rejects requests without the shared cron secret", async () => {
  const handler = createMentionEmailCronHandler({
    cronSecret: "segredo-cron",
    timingSafeEqual: (a, b) => a === b,
    run: () => Promise.resolve(new Response("ok")),
  });
  const response = await handler(new Request("https://example.test/mention-email-cron"));
  assertEquals(response.status, 401);
});

Deno.test("mention-email-cron rejects requests with the wrong cron secret", async () => {
  const handler = createMentionEmailCronHandler({
    cronSecret: "segredo-cron",
    timingSafeEqual: (a, b) => a === b,
    run: () => Promise.resolve(new Response("ok")),
  });
  const response = await handler(
    new Request("https://example.test/mention-email-cron", {
      headers: { "x-cron-secret": "wrong" },
    }),
  );
  assertEquals(response.status, 401);
});

Deno.test("mention-email-cron delegates to run when the secret matches", async () => {
  let called = false;
  const handler = createMentionEmailCronHandler({
    cronSecret: "segredo-cron",
    timingSafeEqual: (a, b) => a === b,
    run: () => {
      called = true;
      return Promise.resolve(new Response("ok"));
    },
  });
  const response = await handler(
    new Request("https://example.test/mention-email-cron", {
      headers: { "x-cron-secret": "segredo-cron" },
    }),
  );
  assertEquals(response.status, 200);
  assert(called);
});

Deno.test("RESEND_API_KEY absent: returns skipped without claiming anything", async () => {
  const db = makeFakeDb([row({ id: 1 })], { u1: "ana@x.test" });
  const { deps, sent } = makeDeps(db, { resendEnabled: false });
  const result = await runMentionEmailCron(deps);
  assertEquals(result, { claimed: 0, emailed: 0, failed: 0, skipped: true });
  assert(!db.updateWasCalled(), "claim UPDATE must not run when Resend is unconfigured");
  assertEquals(sent.length, 0);
  assertEquals(db.rows[0].emailed_at, null);
});

Deno.test("claim honors all five filters: type, read_at, dismissed_at, emailed_at, created_at window", async () => {
  const rows = [
    row({ id: 1, user_id: "u1" }), // eligible
    row({ id: 2, user_id: "u1", created_at: "2026-08-03T11:55:00.000Z" }), // too recent (< 10min ago)
    row({ id: 3, user_id: "u1", created_at: "2026-08-01T11:00:00.000Z" }), // too old (> 24h ago)
    row({ id: 4, user_id: "u1", read_at: "2026-08-03T11:30:00.000Z" }), // already read
    row({ id: 5, user_id: "u1", dismissed_at: "2026-08-03T11:30:00.000Z" }), // dismissed
    row({ id: 6, user_id: "u1", emailed_at: "2026-08-03T11:30:00.000Z" }), // already claimed by another run
    row({ id: 7, user_id: "u1", type: "deadline_approaching" }), // wrong type
  ];
  const db = makeFakeDb(rows, { u1: "ana@x.test" });
  const { deps, sent } = makeDeps(db);
  const result = await runMentionEmailCron(deps);

  assertEquals(result.claimed, 1);
  assertEquals(result.emailed, 1);
  assertEquals(result.failed, 0);
  assertEquals(sent.length, 1);
  assertEquals(sent[0].to, "ana@x.test");

  // Only row 1 got claimed; everything else is untouched.
  assertEquals(db.rows.find((r) => r.id === 1)!.emailed_at, NOW.toISOString());
  for (const id of [2, 3, 4, 5, 6, 7]) {
    const untouched = db.rows.find((r) => r.id === id)!;
    assert(
      untouched.emailed_at === null || untouched.emailed_at === "2026-08-03T11:30:00.000Z",
      `row ${id} was mutated by the claim: ${untouched.emailed_at}`,
    );
  }

  // Step 1 (eligibility SELECT) carries the five filters.
  assertEquals(db.eligibleCalls.length, 1);
  const eligibleCall = db.eligibleCalls[0];
  assertEquals(eligibleCall.eq, { type: "mention" });
  assertEquals(eligibleCall.is, { read_at: null, dismissed_at: null, emailed_at: null });
  assertEquals(eligibleCall.lte, { created_at: CLAIM_BEFORE });
  assertEquals(eligibleCall.gte, { created_at: CLAIM_AFTER });

  // Step 2 (claim UPDATE) narrows to exactly the id found by step 1, plus the
  // emailed_at IS NULL re-check that keeps concurrent runs disjoint.
  assertEquals(db.claimCalls.length, 1);
  const claimCall = db.claimCalls[0];
  assertEquals(claimCall.in, [1]);
  assertEquals(claimCall.is, { emailed_at: null });
});

Deno.test("claim batch is capped: with more than CLAIM_BATCH_SIZE eligible rows, only the oldest 200 are claimed", async () => {
  const rows: FakeNotification[] = [];
  // 205 eligible rows, oldest first by id, all within the eligibility window.
  for (let i = 1; i <= 205; i++) {
    rows.push(
      row({
        id: i,
        user_id: "u1",
        // Spread creation times a second apart, oldest = id 1.
        created_at: new Date(new Date(CLAIM_AFTER).getTime() + i * 1000).toISOString(),
      }),
    );
  }
  const db = makeFakeDb(rows, { u1: "ana@x.test" });
  const { deps } = makeDeps(db);
  const result = await runMentionEmailCron(deps);

  assertEquals(result.claimed, 200, "claim must be capped at CLAIM_BATCH_SIZE");
  assertEquals(db.eligibleCalls[0].limit, 200);

  const claimedRows = db.rows.filter((r) => r.emailed_at === NOW.toISOString());
  assertEquals(claimedRows.length, 200);
  // The 200 claimed must be the oldest 200 (ids 1..200), not an arbitrary slice.
  const claimedIds = claimedRows.map((r) => r.id).sort((a, b) => a - b);
  assertEquals(claimedIds, Array.from({ length: 200 }, (_, i) => i + 1));

  // The 5 leftover (ids 201..205) stay unclaimed for the next run.
  const leftover = db.rows.filter((r) => r.emailed_at === null);
  assertEquals(leftover.length, 5);
});

Deno.test("claim step re-checks emailed_at IS NULL: a row claimed by another run between step 1 and step 2 is not double-claimed", async () => {
  // Minimal purpose-built fake (not the shared makeFakeDb) so step 1's
  // eligibility snapshot can be made stale on purpose: the row looks
  // unclaimed when SELECTed, but a "concurrent run" claims it for real
  // before step 2's UPDATE executes. Only the emailed_at IS NULL re-check in
  // step 2 can stop this from being claimed twice.
  let emailedAt: string | null = null;
  const sent: Array<{ to: string }> = [];

  const db = {
    from(table: string) {
      assert(table === "notifications", `unexpected table ${table}`);
      return {
        // deno-lint-ignore no-explicit-any
        select(_cols: string): any {
          const chain: any = {
            eq: () => chain,
            is: () => chain,
            lte: () => chain,
            gte: () => chain,
            order: () => chain,
            limit: () => chain,
            then(resolve: (v: unknown) => void, reject?: (e: unknown) => void) {
              // The eligibility snapshot is taken here; then a "concurrent run"
              // claims the row for real, before this handler's own step 2 runs.
              emailedAt = "2026-08-03T11:59:00.000Z";
              return Promise.resolve({
                data: [{ id: 1, created_at: "2026-08-03T11:00:00.000Z" }],
                error: null,
              }).then(resolve, reject);
            },
          };
          return chain;
        },
        // deno-lint-ignore no-explicit-any
        update(patch: { emailed_at: string | null }): any {
          const filters = { in: [] as number[], is: {} as Record<string, null> };
          const chain: any = {
            in(col: string, vals: number[]) {
              assert(col === "id", `unexpected .in() column ${col}`);
              filters.in = vals;
              return chain;
            },
            is(col: string, val: null) {
              filters.is[col] = val;
              return chain;
            },
            select(_cols: string) {
              const eligible = filters.in.includes(1) &&
                (!("emailed_at" in filters.is) || emailedAt === null);
              if (eligible) emailedAt = patch.emailed_at;
              return Promise.resolve({
                data: eligible
                  ? [{ id: 1, user_id: "u1", metadata: {}, link: "/", created_at: "2026-08-03T11:00:00.000Z" }]
                  : [],
                error: null,
              });
            },
          };
          return chain;
        },
      };
    },
    auth: {
      admin: {
        getUserById: () =>
          Promise.resolve({ data: { user: { email: "ana@x.test" } }, error: null }),
      },
    },
  };

  const deps: MentionEmailCronDeps = {
    db: db as unknown as MentionEmailDb,
    now: () => NOW,
    resendEnabled: true,
    sendMentionEmail: (p) => {
      sent.push(p);
      return Promise.resolve({ skipped: false });
    },
  };

  const result = await runMentionEmailCron(deps);

  assertEquals(result.claimed, 0, "the row must not be claimed twice");
  assertEquals(sent.length, 0);
  assertEquals(emailedAt, "2026-08-03T11:59:00.000Z", "the other run's claim stands");
});

Deno.test("one email per user: multiple claimed mentions for the same user are batched into a single send", async () => {
  const rows = [
    row({ id: 1, user_id: "u1", metadata: { actor_name: "Ana", context_title: "Post A" } }),
    row({ id: 2, user_id: "u1", metadata: { actor_name: "Bruno", context_title: "Post B" } }),
    row({ id: 3, user_id: "u2", metadata: { actor_name: "Carla", context_title: "Tarefa X" } }),
  ];
  const db = makeFakeDb(rows, { u1: "ana@x.test", u2: "bruno@x.test" });
  const { deps, sent } = makeDeps(db);
  const result = await runMentionEmailCron(deps);

  assertEquals(result.claimed, 3);
  assertEquals(result.emailed, 2);
  assertEquals(result.failed, 0);
  assertEquals(sent.length, 2, "expected exactly one send per distinct user_id");

  const forU1 = sent.find((s) => s.to === "ana@x.test")!;
  assertEquals(forU1.mentions.length, 2);
  assertEquals(forU1.mentions[0].actorName, "Ana");
  assertEquals(forU1.mentions[1].actorName, "Bruno");

  const forU2 = sent.find((s) => s.to === "bruno@x.test")!;
  assertEquals(forU2.mentions.length, 1);
  assertEquals(forU2.mentions[0].actorName, "Carla");
});

Deno.test("metadata fallbacks: missing actor_name/context_title/excerpt degrade gracefully", async () => {
  const db = makeFakeDb(
    [row({ id: 1, metadata: {} })],
    { u1: "ana@x.test" },
  );
  const { deps, sent } = makeDeps(db);
  await runMentionEmailCron(deps);
  assertEquals(sent[0].mentions[0].actorName, "Alguém");
  assertEquals(sent[0].mentions[0].contextTitle, "");
  assertEquals(sent[0].mentions[0].excerpt, undefined);
});

Deno.test("failed send resets that user's claims; other users' claims are unaffected", async () => {
  const rows = [
    row({ id: 1, user_id: "u1" }),
    row({ id: 2, user_id: "u2" }),
  ];
  const db = makeFakeDb(rows, { u1: "ana@x.test", u2: "bruno@x.test" });
  const { deps, sent } = makeDeps(db, {
    sendMentionEmail: (p) => {
      if (p.to === "bruno@x.test") return Promise.reject(new Error("resend down"));
      sent.push(p);
      return Promise.resolve({ skipped: false });
    },
  });
  const result = await runMentionEmailCron(deps);

  assertEquals(result.claimed, 2);
  assertEquals(result.emailed, 1);
  assertEquals(result.failed, 1);

  // u1 (successful) keeps its claim.
  assertEquals(db.rows.find((r) => r.id === 1)!.emailed_at, NOW.toISOString());
  // u2 (failed) had its claim reset so a future run retries it.
  assertEquals(db.rows.find((r) => r.id === 2)!.emailed_at, null);
  assertEquals(db.resetCalls.length, 1);
  assertEquals(db.resetCalls[0], [2]);
});

Deno.test("a user with no resolvable email counts as a failure and resets the claim", async () => {
  const db = makeFakeDb([row({ id: 1, user_id: "u1" })], { u1: null });
  const { deps, sent } = makeDeps(db);
  const result = await runMentionEmailCron(deps);
  assertEquals(result.emailed, 0);
  assertEquals(result.failed, 1);
  assertEquals(sent.length, 0);
  assertEquals(db.rows[0].emailed_at, null);
});

Deno.test("success sets nothing beyond the claim: no reset call happens on the happy path", async () => {
  const db = makeFakeDb([row({ id: 1 })], { u1: "ana@x.test" });
  const { deps } = makeDeps(db);
  await runMentionEmailCron(deps);
  assertEquals(db.resetCalls.length, 0);
});

type ReportDetail = { failed: number; errors: Array<{ accountId?: string; error: string }> };

Deno.test("report is invoked with per-user failures when a send fails", async () => {
  const db = makeFakeDb([row({ id: 1, user_id: "u1" })], { u1: "ana@x.test" });
  let reported: ReportDetail | null = null;
  const { deps } = makeDeps(db, {
    sendMentionEmail: () => Promise.reject(new Error("boom")),
    report: (detail) => {
      reported = detail;
      return Promise.resolve();
    },
  });
  await runMentionEmailCron(deps);
  assert(reported !== null, "triage report missing");
  assertEquals((reported as ReportDetail).failed, 1);
  assertEquals((reported as ReportDetail).errors[0].accountId, "u1");
});

Deno.test("no eligible rows: returns zeroed counts without touching sendMentionEmail", async () => {
  const db = makeFakeDb([], {});
  const { deps, sent } = makeDeps(db);
  const result = await runMentionEmailCron(deps);
  assertEquals(result, { claimed: 0, emailed: 0, failed: 0, skipped: false });
  assertEquals(sent.length, 0);
});
