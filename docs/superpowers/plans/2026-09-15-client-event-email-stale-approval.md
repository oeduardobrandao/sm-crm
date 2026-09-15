# Client-Event-Email Stale-Approval Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the client-facing "Pendências do Hub" digest from permanently ignoring a pending post approval just because it's more than 72 hours old, and recover the clients already stuck in that state on production.

**Architecture:** `client-event-email-cron` currently computes ONE shared lower bound (`GREATEST(event_cursor_at, now-72h)`) for both its pending-approvals query and its unread-messages query. Task 1 splits this into two independent lower bounds in `handler.ts`: approvals drop the 72h floor entirely (the query is already scoped to posts whose *current* status is still `enviado_cliente`, so there's no backlog-dump risk), messages keep it (the email only renders a message *count*, and a stale large count is worse UX, not a content dump). Task 2 deploys that change to production and runs a one-time SQL backfill that rewinds the cursor for clients whose orphaned posts predate a cursor that already advanced past them (the code fix alone can't reach those — `created_at > cursor` still excludes them going forward).

**Tech Stack:** Deno edge function (Supabase), `deno test` for the function's own test suite, `npx supabase db query --linked` for the production SQL steps (no local DB needed for those).

## Global Constraints

- Full design rationale, the correctness proof for the backfill criterion, and every finding from two rounds of external review live in `docs/superpowers/specs/2026-09-15-client-event-email-stale-approval-design.md` — read it before starting if anything below is unclear about *why*, not just *what*.
- **This plan must NOT be implemented in the worktree the spec was written in** (`.claude/worktrees/feature-requirements-54a250`). That worktree is 87 commits behind `origin/main` and does not contain `client-event-email-cron` at all. Start Task 1 from a fresh worktree/branch checked out from current `origin/main` (use the `superpowers:using-git-worktrees` skill to provision it).
- No database migration, no new environment variable, no new feature flag. The only file this plan modifies is `supabase/functions/client-event-email-cron/handler.ts` (plus its test file). Task 2 is a deploy + a one-off SQL script, not a code change.
- Deploy this function with `--use-api` (this repo's local Docker bundler is broken for edge functions per project convention) and `--no-verify-jwt` (it authenticates via the `x-cron-secret` header, not a JWT).

---

### Task 1: Split the 72h floor by content type

**Files:**
- Modify: `supabase/functions/client-event-email-cron/handler.ts`
- Test: `supabase/functions/__tests__/client-event-email-cron_test.ts`

**Interfaces:**
- Consumes: nothing new — this task only changes internal window-computation logic inside `runClientEventEmailCron`. No exported signature changes.
- Produces: same exported `runClientEventEmailCron`, `createClientEventEmailCronHandler`, `buildClientEventIdempotencyKey`, `ClaimedClientEventRow`, `ClientEventEmailCronDeps`, `ClientEventEmailDb`, `ClientEventEmailCronResult` — all unchanged in shape. No other task in this plan depends on new interfaces from this one.

- [ ] **Step 1: Update the two existing tests whose expected behavior changes**

Open `supabase/functions/__tests__/client-event-email-cron_test.ts`. Replace the test at (current) line 393 and the test at (current) line 418 — these currently assert the OLD floor-exclusion behavior, which this task removes for approvals.

Replace:

```ts
Deno.test("NULL cursor: lower bound is now-72h, an event 80h old is excluded", async () => {
  const db = makeFakeDb(
    [claimedRow({ id: 2, conta_id: "ws1", event_cursor_at: null, event_claim_through: NOW.toISOString() })],
    {
      postStatusEvents: [
        {
          id: 20,
          post_id: 200,
          conta_id: "ws1",
          to_status: "enviado_cliente",
          created_at: "2026-08-10T04:00:00.000Z", // 80h before NOW
          workflow_posts: { cliente_id: 2, status: "enviado_cliente", tipo: "feed", titulo: "Old post" },
        },
      ],
    },
  );
  const { deps } = makeDeps(db);
  const r = await runClientEventEmailCron(deps);
  assertEquals(r.skippedNoContent, 1);
  assertEquals(r.emailed, 0);
  assertEquals(db.releaseCalls, [{ ids: [2], patch: { event_claim_through: null } }]);
});
```

with:

```ts
Deno.test("NULL cursor: an 80h-old pending approval is now included (no floor on approvals)", async () => {
  const db = makeFakeDb(
    [claimedRow({ id: 2, conta_id: "ws1", event_cursor_at: null, event_claim_through: NOW.toISOString() })],
    {
      postStatusEvents: [
        {
          id: 20,
          post_id: 200,
          conta_id: "ws1",
          to_status: "enviado_cliente",
          created_at: "2026-08-10T04:00:00.000Z", // 80h before NOW -- excluded under the old 72h floor
          workflow_posts: { cliente_id: 2, status: "enviado_cliente", tipo: "feed", titulo: "Old post" },
        },
      ],
      workspaces: [{ id: "ws1", name: "Agencia X", brand_color: "#ffbf30", logo_url: null }],
    },
  );
  const { deps, sent } = makeDeps(db);
  const r = await runClientEventEmailCron(deps);
  assertEquals(r.emailed, 1);
  assertEquals(r.skippedNoContent, 0);
  assert(sent[0].html.includes("Old post"), "expected the 80h-old post to be included, not floor-excluded");
});
```

Replace:

```ts
Deno.test("cursor 5 days old: lower bound is still now-72h (GREATEST)", async () => {
  const db = makeFakeDb(
    [
      claimedRow({
        id: 3,
        conta_id: "ws1",
        event_cursor_at: "2026-08-08T12:00:00.000Z", // 5 days before NOW
        event_claim_through: NOW.toISOString(),
      }),
    ],
    {
      postStatusEvents: [
        // Inside the cursor-based window but OUTSIDE now-72h: must be excluded.
        {
          id: 30,
          post_id: 300,
          conta_id: "ws1",
          to_status: "enviado_cliente",
          created_at: "2026-08-09T12:00:00.000Z",
          workflow_posts: { cliente_id: 3, status: "enviado_cliente", tipo: "feed", titulo: "Too old" },
        },
        // Inside now-72h: must survive.
        {
          id: 31,
          post_id: 301,
          conta_id: "ws1",
          to_status: "enviado_cliente",
          created_at: "2026-08-13T11:00:00.000Z",
          workflow_posts: { cliente_id: 3, status: "enviado_cliente", tipo: "feed", titulo: "Recent" },
        },
      ],
      workspaces: [{ id: "ws1", name: "Agencia X", brand_color: "#ffbf30", logo_url: null }],
    },
  );
  const { deps, sent } = makeDeps(db);
  const r = await runClientEventEmailCron(deps);
  assertEquals(r.emailed, 1);
  assert(sent[0].html.includes("Recent"), "expected the in-window post");
  assert(!sent[0].html.includes("Too old"), "expected the clamped-out post to be excluded");
});
```

with:

```ts
Deno.test("cursor 5 days old: both events included now (no floor clamp on approvals)", async () => {
  const db = makeFakeDb(
    [
      claimedRow({
        id: 3,
        conta_id: "ws1",
        event_cursor_at: "2026-08-08T12:00:00.000Z", // 5 days before NOW
        event_claim_through: NOW.toISOString(),
      }),
    ],
    {
      postStatusEvents: [
        // Would have been clamped out by the old 72h floor -- now included,
        // since the only lower bound left for approvals is the cursor itself.
        {
          id: 30,
          post_id: 300,
          conta_id: "ws1",
          to_status: "enviado_cliente",
          created_at: "2026-08-09T12:00:00.000Z",
          workflow_posts: { cliente_id: 3, status: "enviado_cliente", tipo: "feed", titulo: "Older" },
        },
        {
          id: 31,
          post_id: 301,
          conta_id: "ws1",
          to_status: "enviado_cliente",
          created_at: "2026-08-13T11:00:00.000Z",
          workflow_posts: { cliente_id: 3, status: "enviado_cliente", tipo: "feed", titulo: "Recent" },
        },
      ],
      workspaces: [{ id: "ws1", name: "Agencia X", brand_color: "#ffbf30", logo_url: null }],
    },
  );
  const { deps, sent } = makeDeps(db);
  const r = await runClientEventEmailCron(deps);
  assertEquals(r.emailed, 1);
  assert(sent[0].html.includes("Recent"), "expected the recent post");
  assert(sent[0].html.includes("Older"), "expected the previously floor-excluded post to now be included");
});
```

- [ ] **Step 2: Add four new tests that lock down the split (messages keep the floor; the two bounds are independent)**

Add these four tests directly after the two you just replaced (same file):

```ts
Deno.test("NULL cursor: messages still respect the 72h floor (an 80h-old message is excluded)", async () => {
  const db = makeFakeDb(
    [claimedRow({ id: 4, conta_id: "ws1", event_cursor_at: null, event_claim_through: NOW.toISOString() })],
    {
      mensagens: [
        { id: 40, conta_id: "ws1", cliente_id: 4, is_workspace_user: true, created_at: "2026-08-10T04:00:00.000Z" }, // 80h before NOW
      ],
    },
  );
  const { deps } = makeDeps(db);
  const r = await runClientEventEmailCron(deps);
  assertEquals(r.skippedNoContent, 1);
  assertEquals(r.emailed, 0);
});

Deno.test("cursor 5 days old: messages older than 72h are still clamped out (GREATEST still applies to messages)", async () => {
  const db = makeFakeDb(
    [
      claimedRow({
        id: 5,
        conta_id: "ws1",
        event_cursor_at: "2026-08-08T12:00:00.000Z", // 5 days before NOW
        event_claim_through: NOW.toISOString(),
      }),
    ],
    {
      mensagens: [
        // Inside the cursor-based window but OUTSIDE now-72h: must still be excluded.
        { id: 50, conta_id: "ws1", cliente_id: 5, is_workspace_user: true, created_at: "2026-08-09T12:00:00.000Z" },
        // Inside now-72h: must survive.
        { id: 51, conta_id: "ws1", cliente_id: 5, is_workspace_user: true, created_at: "2026-08-13T11:00:00.000Z" },
      ],
      workspaces: [{ id: "ws1", name: "Agencia X", brand_color: "#ffbf30", logo_url: null }],
    },
  );
  const { deps, auditCalls } = makeDeps(db);
  const r = await runClientEventEmailCron(deps);
  assertEquals(r.emailed, 1);
  assertEquals(auditCalls[0].metadata, { posts: 0, messages: 1 });
});

Deno.test("mixed: an 80h-old approval ships in the digest, an 80h-old message does not (independent lower bounds)", async () => {
  const db = makeFakeDb(
    [claimedRow({ id: 6, conta_id: "ws1", event_cursor_at: null, event_claim_through: NOW.toISOString() })],
    {
      postStatusEvents: [
        {
          id: 60,
          post_id: 600,
          conta_id: "ws1",
          to_status: "enviado_cliente",
          created_at: "2026-08-10T04:00:00.000Z", // 80h before NOW
          workflow_posts: { cliente_id: 6, status: "enviado_cliente", tipo: "feed", titulo: "Old approval" },
        },
      ],
      mensagens: [
        // Same age as the approval above -- proves the two bounds are evaluated independently,
        // not that one happens to be more lenient across the board.
        { id: 61, conta_id: "ws1", cliente_id: 6, is_workspace_user: true, created_at: "2026-08-10T04:00:00.000Z" },
      ],
      workspaces: [{ id: "ws1", name: "Agencia X", brand_color: "#ffbf30", logo_url: null }],
    },
  );
  const { deps, sent, auditCalls } = makeDeps(db);
  const r = await runClientEventEmailCron(deps);
  assertEquals(r.emailed, 1);
  assert(sent[0].html.includes("Old approval"), "expected the stale approval to ship");
  assertEquals(auditCalls[0].metadata, { posts: 1, messages: 0 });
});

Deno.test("post-backfill state: old non-null cursor with an approval and a message both between cursor and now-72h -- approval ships, message doesn't", async () => {
  const db = makeFakeDb(
    [
      claimedRow({
        id: 7,
        conta_id: "ws1",
        event_cursor_at: "2026-08-08T12:00:00.000Z", // simulates a backfill-rewound cursor, 5 days before NOW
        event_claim_through: NOW.toISOString(),
      }),
    ],
    {
      postStatusEvents: [
        {
          id: 70,
          post_id: 700,
          conta_id: "ws1",
          to_status: "enviado_cliente",
          created_at: "2026-08-09T00:00:00.000Z", // after cursor, before now-72h (2026-08-10T12:00)
          workflow_posts: { cliente_id: 7, status: "enviado_cliente", tipo: "feed", titulo: "Rewound approval" },
        },
      ],
      mensagens: [
        { id: 71, conta_id: "ws1", cliente_id: 7, is_workspace_user: true, created_at: "2026-08-09T00:00:00.000Z" },
      ],
      workspaces: [{ id: "ws1", name: "Agencia X", brand_color: "#ffbf30", logo_url: null }],
    },
  );
  const { deps, sent, auditCalls } = makeDeps(db);
  const r = await runClientEventEmailCron(deps);
  assertEquals(r.emailed, 1);
  assert(sent[0].html.includes("Rewound approval"), "expected the rewound-cursor approval to ship");
  assertEquals(auditCalls[0].metadata, { posts: 1, messages: 0 });
});
```

- [ ] **Step 3: Run the test file to verify the six tests from Steps 1-2 fail against the CURRENT (unfixed) handler**

Run: `deno test --allow-env supabase/functions/__tests__/client-event-email-cron_test.ts`

Expected: the two replaced tests and the four new tests FAIL (the two "old floor" tests plus the two "messages keep the floor" tests will actually pass already — the messages side isn't changing — but the "NULL cursor... included", "both events included", "mixed", and "post-backfill" tests must fail, since the current code still floors approvals at 72h). If any of those four don't fail, stop and re-check the test data against the current handler logic before proceeding — the point of this step is confirming the test actually exercises the bug.

- [ ] **Step 4: Implement the split lower bound in `handler.ts`**

Add the `EPOCH` constant right after the existing `SEVENTY_TWO_HOURS_MS` constant (currently line 160):

```ts
const SEVENTY_TWO_HOURS_MS = 72 * 3600_000;
const EPOCH = new Date(0);
const CLAIM_BATCH_SIZE = 50;
```

Replace the window-computation block (currently lines 311-315):

```ts
      const floor = new Date(now.getTime() - SEVENTY_TWO_HOURS_MS);
      const lower = maxDate(row.event_cursor_at, floor);
      const upper = new Date(row.event_claim_through);
      const lowerIso = lower.toISOString();
      const upperIso = upper.toISOString();
```

with:

```ts
      // Aprovações: sem piso -- ver cabeçalho do arquivo. Um cursor nulo vira
      // EPOCH diretamente (não há floor para comparar contra via maxDate).
      const approvalsLower = row.event_cursor_at ? new Date(row.event_cursor_at) : EPOCH;
      const approvalsLowerIso = approvalsLower.toISOString();
      const upper = new Date(row.event_claim_through);
      const upperIso = upper.toISOString();
```

Update the approvals query's `.gt()` call (currently line 329) from:

```ts
        .gt("created_at", lowerIso)
```

to:

```ts
        .gt("created_at", approvalsLowerIso)
```

Replace the unread-messages section's lower-bound computation (currently lines 372-382):

```ts
      // ---- unread messages -----------------------------------------------------
      const { data: seenRows, error: seenErr } = await deps.db
        .from("mensagens_last_seen")
        .select("last_seen_at")
        .eq("conta_id", row.conta_id)
        .eq("cliente_id", row.id);
      if (seenErr) throw new Error(`mensagens_last_seen query failed: ${seenErr.message}`);
      const lastSeenAt = (seenRows?.[0] as { last_seen_at: string } | undefined)?.last_seen_at ?? null;
      // created_at > window_lower AND created_at > last_seen_at
      //   == created_at > GREATEST(window_lower, last_seen_at)
      const msgLower = maxDate(lastSeenAt, lower);
```

with:

```ts
      // ---- unread messages -----------------------------------------------------
      const { data: seenRows, error: seenErr } = await deps.db
        .from("mensagens_last_seen")
        .select("last_seen_at")
        .eq("conta_id", row.conta_id)
        .eq("cliente_id", row.id);
      if (seenErr) throw new Error(`mensagens_last_seen query failed: ${seenErr.message}`);
      const lastSeenAt = (seenRows?.[0] as { last_seen_at: string } | undefined)?.last_seen_at ?? null;
      // Mensagens: mantém o piso de 72h (o e-mail só mostra uma CONTAGEM, não o
      // conteúdo -- ver cabeçalho do arquivo). created_at > window_lower AND
      // created_at > last_seen_at == created_at > GREATEST(window_lower, last_seen_at).
      const messagesFloor = new Date(now.getTime() - SEVENTY_TWO_HOURS_MS);
      const messagesCursorLower = maxDate(row.event_cursor_at, messagesFloor);
      const msgLower = maxDate(lastSeenAt, messagesCursorLower);
```

No other line in the function references `lower` or `lowerIso` — both names are now fully removed from the file, so nothing else needs updating in the function body.

- [ ] **Step 5: Update the four stale doc comments**

These describe the old single-floor design and would mislead the next reader if left as-is.

Replace (currently lines 22-29, inside the big header comment):

```
 * outcome (empty content, no Hub link, send failure, a post-send bookkeeping
 * failure) clears ONLY the lease (`event_claim_through`) and leaves both the
 * cursor AND `event_claimed_at` exactly where they were -- the cursor so the
 * same window (or a superset, once GREATEST'd against now()-72h) gets
 * retried, and `event_claimed_at` so the claim RPC's own 30-minute gate
 * becomes a natural backoff for a client that keeps coming up empty, instead
 * of that client being re-claimed and re-queried every 15 minutes forever.
```

with:

```
 * outcome (empty content, no Hub link, send failure, a post-send bookkeeping
 * failure) clears ONLY the lease (`event_claim_through`) and leaves both the
 * cursor AND `event_claimed_at` exactly where they were -- the cursor so the
 * same window (or a superset -- approvals grow unbounded from the same
 * cursor, messages still clamp to now()-72h) gets retried, and
 * `event_claimed_at` so the claim RPC's own 30-minute gate becomes a natural
 * backoff for a client that keeps coming up empty, instead of that client
 * being re-claimed and re-queried every 15 minutes forever.
```

Replace (currently lines 34-37):

```
 * Window per client: `(GREATEST(event_cursor_at, now-72h), event_claim_through]`.
 * The 72h floor applies unconditionally -- a client with a NULL cursor (never
 * emailed) or a very old one (rejoined after a long opt-out) never gets a
 * multi-day backlog dumped on them.
```

with:

```
 * Window per client is now TWO independent lower bounds, not one shared floor:
 *  - Approvals: `(event_cursor_at ?? EPOCH, event_claim_through]` -- no floor.
 *    The query is already bounded to posts whose CURRENT status is still
 *    `enviado_cliente`, so there is no "backlog dump" risk, and a pending
 *    approval older than 72h is exactly the case most worth surfacing.
 *  - Messages: `(GREATEST(event_cursor_at, now-72h, mensagens_last_seen), event_claim_through]`
 *    -- the 72h floor still applies here. The email only renders a COUNT of
 *    unread messages, not their content, so the risk isn't "dumping text",
 *    it's showing a large, stale, unhelpful number to a client re-opting-in
 *    after a long absence.
```

Replace (currently lines 521-529, right before the post-send cursor-advance `update`):

```
      // `boundIso` (computed above, right after the tie-completed/folded
      // safeUpperMs) is exactly what was fetched, trimmed, and just sent --
      // normally `upper` (claim_through), or the more conservative capped
      // bound when either query was over-dense. Advancing the cursor to it
      // (never past it) is what keeps the un-fetched/trimmed-out remainder
      // for the next tick's window instead of falsely marking it delivered.
      // boundIso is always > lowerIso by construction (it comes from a row
      // that already passed the `gt` filter, or is `upper` itself), so this
      // can never move the cursor backwards.
```

with:

```
      // `boundIso` (computed above, right after the tie-completed/folded
      // safeUpperMs) is exactly what was fetched, trimmed, and just sent --
      // normally `upper` (claim_through), or the more conservative capped
      // bound when either query was over-dense. Advancing the cursor to it
      // (never past it) is what keeps the un-fetched/trimmed-out remainder
      // for the next tick's window instead of falsely marking it delivered.
      // boundIso is always > approvalsLowerIso and > msgLower by construction
      // (it comes from a row that already passed one of the two `gt` filters,
      // or is `upper` itself), so this can never move the cursor backwards.
```

- [ ] **Step 6: Run the test file again, verify all tests pass**

Run: `deno test --allow-env supabase/functions/__tests__/client-event-email-cron_test.ts`

Expected: PASS, every test in the file (the six from Steps 1-2 plus every pre-existing test — including the cap/tie-completion tests further down the file, which are unaffected since they already use candidate data that falls inside the old 72h floor and don't rely on floor-exclusion for their assertions).

- [ ] **Step 7: Lint check**

Run: `npx eslint supabase/functions/client-event-email-cron/handler.ts`

Expected: no errors. In particular, confirm there is no "unused variable" warning for `lower` or `lowerIso` — Step 4 removed both names entirely, so none should remain.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/client-event-email-cron/handler.ts supabase/functions/__tests__/client-event-email-cron_test.ts
git commit -m "fix(client-event-email-cron): drop the 72h floor for pending approvals

A post stuck in enviado_cliente for more than 72h was permanently
invisible to the client digest: the shared lower bound floored at
now()-72h, and once the cursor advanced past an excluded event it never
revisited it. Approvals now use the cursor alone (no floor) since the
query is already scoped to currently-pending posts; messages keep the
floor since the email only renders an unread count, and a stale large
count is worse UX, not a content-dump risk."
```

---

### Task 2: Deploy and run the production backfill

**Files:** none (deploy + SQL only, no code changes in this task).

**Interfaces:** none — this task consumes the deployed behavior from Task 1 and mutates production data (`clientes.event_cursor_at`) directly via SQL.

This task is an operational runbook, not a code change — follow it in order, on production, using the exact SQL below (already verified against production data during design: identifies exactly 10 orphaned posts across 4 clients in the Hanna Marques workspace, none of which were already-delivered false positives).

- [ ] **Step 1: Pause the cron**

Write this to a scratch file and run it:

```sql
select cron.unschedule('client-event-email-cron');
```

Run: `npx supabase db query --linked --file <scratch-file>.sql`

Then wait 90 seconds (any execution already in flight completes on its own within `SEND_DEADLINE_MS` = 60s per batch). This step is not optional: the backfill's orphan criterion in Step 3 only answers the right question if evaluated against history from BEFORE any post-fix send has happened (see the spec's "Isto não é uma ferramenta para rodar repetidamente" section for why).

- [ ] **Step 2: Deploy the function**

Run: `npx supabase functions deploy client-event-email-cron --use-api --no-verify-jwt`

- [ ] **Step 3: Run the backfill preview and review it**

Write this to a scratch file:

```sql
WITH current_arrival AS (
  SELECT DISTINCT ON (wp.id)
         wp.id AS post_id, wp.cliente_id, pse.created_at AS arrived_at
  FROM workflow_posts wp
  JOIN post_status_events pse
    ON pse.post_id = wp.id AND pse.to_status = 'enviado_cliente'
  WHERE wp.status = 'enviado_cliente'
  ORDER BY wp.id, pse.created_at DESC
),
orphaned_posts AS (
  SELECT ca.post_id, ca.cliente_id, ca.arrived_at
  FROM current_arrival ca
  JOIN clientes cl ON cl.id = ca.cliente_id
  WHERE cl.event_cursor_at IS NOT NULL
    AND ca.arrived_at <= cl.event_cursor_at
    AND NOT EXISTS (
      SELECT 1 FROM audit_log a
      WHERE a.action = 'client_event_email_sent'
        AND a.resource_type = 'cliente'
        AND a.resource_id = ca.cliente_id::text
        AND a.created_at >= ca.arrived_at
        AND a.created_at <  ca.arrived_at + interval '72 hours'
    )
)
SELECT op.cliente_id, cl.nome, cl.conta_id, cl.event_cursor_at AS current_cursor,
       min(op.arrived_at) - interval '1 second' AS new_cursor,
       count(*) AS orphaned_posts
FROM orphaned_posts op
JOIN clientes cl ON cl.id = op.cliente_id
GROUP BY op.cliente_id, cl.nome, cl.conta_id, cl.event_cursor_at
ORDER BY cl.conta_id, op.cliente_id;
```

Run: `npx supabase db query --linked --file <scratch-file>.sql`

Record the full list of `cliente_id` values returned — this is the expected set for the reconciliation in Step 4. As of 2026-09-15 this returns 4 rows for the Hanna Marques workspace (`d8074873-596f-49e5-995d-4b51ce62569d`): clients 405, 407, 409, 416. Other workspaces on the platform may also appear; that's expected (this bug isn't specific to one workspace).

- [ ] **Step 4: Run the backfill and reconcile against the preview**

Write this to a scratch file:

```sql
WITH current_arrival AS (
  SELECT DISTINCT ON (wp.id)
         wp.id AS post_id, wp.cliente_id, pse.created_at AS arrived_at
  FROM workflow_posts wp
  JOIN post_status_events pse
    ON pse.post_id = wp.id AND pse.to_status = 'enviado_cliente'
  WHERE wp.status = 'enviado_cliente'
  ORDER BY wp.id, pse.created_at DESC
),
orphaned AS (
  SELECT ca.cliente_id, min(ca.arrived_at) - interval '1 second' AS new_cursor
  FROM current_arrival ca
  JOIN clientes cl ON cl.id = ca.cliente_id
  WHERE cl.event_cursor_at IS NOT NULL
    AND ca.arrived_at <= cl.event_cursor_at
    AND NOT EXISTS (
      SELECT 1 FROM audit_log a
      WHERE a.action = 'client_event_email_sent'
        AND a.resource_type = 'cliente'
        AND a.resource_id = ca.cliente_id::text
        AND a.created_at >= ca.arrived_at
        AND a.created_at <  ca.arrived_at + interval '72 hours'
    )
  GROUP BY ca.cliente_id
)
UPDATE clientes c
SET event_cursor_at = orphaned.new_cursor
FROM orphaned
WHERE c.id = orphaned.cliente_id
  AND c.event_claim_through IS NULL
RETURNING c.id, c.nome, c.conta_id, c.event_cursor_at;
```

Run: `npx supabase db query --linked --file <scratch-file>.sql`

Compare the `id` values in the result against the `cliente_id` values recorded in Step 3. If every id from Step 3 appears in this result, proceed to Step 5. If any is missing, that client had `event_claim_through` still set (a lease the pause in Step 1 didn't clear in time) — re-run this exact same SQL again (it's idempotent within this paused window: a client already updated no longer matches `ca.arrived_at <= cl.event_cursor_at`, so re-running only retries whoever is still missing) until the two lists match.

- [ ] **Step 5: Resume the cron**

Write this to a scratch file (verbatim from `supabase/migrations/20260904000001_client_event_emails.sql:178-192`):

```sql
select cron.schedule(
  'client-event-email-cron',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
            || '/functions/v1/client-event-email-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
```

Run: `npx supabase db query --linked --file <scratch-file>.sql`

- [ ] **Step 6: Verify delivery on the next tick**

Wait up to 15 minutes, then write this to a scratch file:

```sql
SELECT resource_id, created_at, metadata
FROM audit_log
WHERE action = 'client_event_email_sent'
  AND resource_id IN ('405', '407', '409', '416')
ORDER BY created_at DESC
LIMIT 10;
```

Run: `npx supabase db query --linked --file <scratch-file>.sql`

Expected: a fresh row (timestamp after Step 5's resume) for each of the four Hanna Marques clients, confirming they received the recovery digest. (Adjust the `resource_id` list to match whatever Step 3 actually returned if other workspaces were also affected.)

- [ ] **Step 7: Commit the plan/spec status**

No code changed in this task, so there's nothing to `git commit` here — this step is a checkpoint, not a commit. Update the tracking issue or notify the requester that the fix is live and the backfill has completed, citing the Step 6 verification output.

---

## Self-Review Notes

- **Spec coverage:** the split lower bound (Decisão 1, Design técnico) → Task 1. The no-recurring-reminder decision (Decisão 2) requires no code — it's the absence of a feature, verified by the fact that no task adds one. The platform-wide, pause-first rollout with reconciliation (Decisão 3, 4, Rollout) → Task 2. The four "Limitações aceitas" are explicitly accepted trade-offs in the spec, not action items — no task needed for them. The `EXPLAIN ANALYZE` query-cost concern was resolved during design (0.571ms, verified) — no task needed.
- **Placeholder scan:** no TBD/TODO; every step has literal runnable code or SQL, not a description of what to write.
- **Type consistency:** `runClientEventEmailCron`, `ClientEventEmailCronDeps`, `ClaimedClientEventRow`, `ClientEventEmailDb` are read from the actual current file (`supabase/functions/client-event-email-cron/handler.ts` on `origin/main`) and unchanged by this plan — Task 1 only touches internal `const` bindings inside the function body, never anything exported.
- **Ambiguity check:** Task 2's SQL is copy-pasted verbatim from the spec, already validated against production twice (once with an earlier, corrected criterion; re-verified after the criterion's final fix) — no interpretation left to the executor beyond "run this in order."
