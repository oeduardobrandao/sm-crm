import { assert, assertEquals } from "./assert.ts";
import {
  buildClientEventIdempotencyKey,
  type ClaimedClientEventRow,
  type ClientEventEmailCronDeps,
  type ClientEventEmailDb,
  createClientEventEmailCronHandler,
  runClientEventEmailCron,
} from "../client-event-email-cron/handler.ts";
import { signUnsubToken } from "../_shared/client-event-email.ts";

const NOW = new Date("2026-08-13T12:00:00.000Z"); // NOW - 72h = 2026-08-10T12:00:00.000Z

// ─── Minimal in-memory relational fake (express-post-cleanup-cron's pattern):
// candidate rows per table are filtered/ordered for real against the exact
// eq/gt/lte/order calls the handler issues, so the window math and the
// dedupe/status-filter logic are genuinely exercised, not just echoed back. ───

type Row = Record<string, unknown>;
type Filter =
  | { op: "eq"; column: string; value: unknown }
  | { op: "gt"; column: string; value: unknown }
  | { op: "lte"; column: string; value: unknown };

function getPath(row: Row, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc == null || typeof acc !== "object") return undefined;
    return (acc as Row)[key];
  }, row);
}

/** -1/0/1 for two values of the same comparable type (string or number) --
 * used by both the gt/lte filter check and the multi-key sort below, since
 * the handler now compares timestamps (string) AND ids (number) via the
 * same `.gt()`/`.order()` chain methods. */
function compareValues(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;
  return 0;
}

function matchesRow(row: Row, filters: Filter[]): boolean {
  return filters.every((f) => {
    const v = getPath(row, f.column);
    if (f.op === "eq") return v === f.value;
    if (f.op === "gt") return compareValues(v, f.value) > 0;
    if (f.op === "lte") return compareValues(v, f.value) <= 0;
    return false;
  });
}

function makeSelectChain(rows: Row[]) {
  const filters: Filter[] = [];
  // Multiple `.order()` calls chain into a multi-key sort (primary, then
  // tiebreak) -- matches real supabase-js/PostgREST semantics.
  const orders: Array<{ column: string; ascending: boolean }> = [];
  let limitCount: number | undefined;
  // deno-lint-ignore no-explicit-any
  const chain: any = {
    eq(column: string, value: unknown) {
      filters.push({ op: "eq", column, value });
      return chain;
    },
    gt(column: string, value: unknown) {
      filters.push({ op: "gt", column, value });
      return chain;
    },
    lte(column: string, value: unknown) {
      filters.push({ op: "lte", column, value });
      return chain;
    },
    order(column: string, opts: { ascending: boolean }) {
      orders.push({ column, ascending: opts.ascending });
      return chain;
    },
    limit(count: number) {
      limitCount = count;
      return chain;
    },
    then(onFulfilled: (v: { data: Row[] | null; error: { message: string } | null }) => unknown) {
      let result = rows.filter((r) => matchesRow(r, filters));
      if (orders.length > 0) {
        result = [...result].sort((a, b) => {
          for (const { column, ascending } of orders) {
            const cmp = compareValues(getPath(a, column), getPath(b, column));
            if (cmp === 0) continue;
            return ascending ? cmp : -cmp;
          }
          return 0;
        });
      }
      if (limitCount !== undefined) result = result.slice(0, limitCount);
      return Promise.resolve(onFulfilled({ data: result, error: null }));
    },
  };
  return chain;
}

function makeFakeDb(
  claimReturn: ClaimedClientEventRow[],
  tables: {
    postStatusEvents?: Row[];
    mensagens?: Row[];
    mensagensLastSeen?: Row[];
    workspaces?: Row[];
  } = {},
) {
  // Captures the FULL patch object (not just ids) so tests can assert that a
  // release/success update never touches event_claimed_at -- omitting the
  // key entirely is what proves the column is left alone (see the
  // controller ruling on anti-starvation backoff/rotation in handler.ts).
  const releaseCalls: Array<{ ids: number[]; patch: Record<string, unknown> }> = [];
  const successCalls: Array<{ ids: number[]; patch: Record<string, unknown> }> = [];
  let rpcCalls = 0;
  const db = {
    releaseCalls,
    successCalls,
    rpcCallCount: () => rpcCalls,
    rpc(_fn: string, _args: unknown) {
      rpcCalls++;
      return Promise.resolve({ data: claimReturn, error: null });
    },
    from(table: string) {
      if (table === "clientes") {
        return {
          update(patch: Record<string, unknown>) {
            return {
              in(_col: string, ids: number[]) {
                if ("event_cursor_at" in patch) {
                  successCalls.push({ ids, patch });
                } else {
                  releaseCalls.push({ ids, patch });
                }
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }
      const rows = table === "post_status_events"
        ? tables.postStatusEvents ?? []
        : table === "mensagens"
        ? tables.mensagens ?? []
        : table === "mensagens_last_seen"
        ? tables.mensagensLastSeen ?? []
        : table === "workspaces"
        ? tables.workspaces ?? []
        : [];
      return {
        select(_cols: string) {
          return makeSelectChain(rows);
        },
      };
    },
  };
  return db;
}

function claimedRow(
  over: Partial<ClaimedClientEventRow> & { id: number; conta_id: string },
): ClaimedClientEventRow {
  return {
    nome: "Ana Cliente",
    email: "ana@x.test",
    event_cursor_at: null,
    event_claim_through: NOW.toISOString(),
    ...over,
  };
}

function makeDeps(db: ReturnType<typeof makeFakeDb>, over?: Partial<ClientEventEmailCronDeps>) {
  const sent: Array<
    {
      to: string;
      subject: string;
      html: string;
      idempotencyKey: string;
      headers: Record<string, string>;
      from: string;
    }
  > = [];
  const auditCalls: Array<Record<string, unknown>> = [];
  const deps: ClientEventEmailCronDeps = {
    db: db as unknown as ClientEventEmailDb,
    now: () => NOW,
    resendEnabled: true,
    tokenSecret: "test-secret",
    unsubBaseUrl: "https://x.supabase.co",
    resolveHubUrl: () => Promise.resolve("https://app.mesaas.com.br/w/x/hub/tok"),
    sendEmail: (p) => {
      sent.push({
        to: p.to,
        subject: p.subject,
        html: p.html,
        idempotencyKey: p.idempotencyKey,
        headers: p.headers,
        from: p.from,
      });
      return Promise.resolve();
    },
    auditLog: (entry) => {
      auditCalls.push(entry);
      return Promise.resolve();
    },
    ...over,
  };
  return { deps, sent, auditCalls };
}

// --- 1. RESEND disabled ------------------------------------------------------

Deno.test("RESEND unset: skipped, claim never called", async () => {
  const db = makeFakeDb([]);
  const { deps } = makeDeps(db, { resendEnabled: false });
  const r = await runClientEventEmailCron(deps);
  assertEquals(r, {
    claimed: 0,
    emailed: 0,
    skippedNoContent: 0,
    skippedNoHub: 0,
    failed: 0,
    released: 0,
    skipped: true,
  });
  assertEquals(db.rpcCallCount(), 0);
});

// --- 2. empty claim -----------------------------------------------------------

Deno.test("empty claim: no-op", async () => {
  const db = makeFakeDb([]);
  const { deps } = makeDeps(db);
  const r = await runClientEventEmailCron(deps);
  assertEquals(r, { claimed: 0, emailed: 0, skippedNoContent: 0, skippedNoHub: 0, failed: 0, released: 0 });
});

// --- 3. full success -----------------------------------------------------------

Deno.test("claimed client with 2 pending posts + 1 unseen message: window, one email, cursor advance, audit", async () => {
  const cursor = "2026-08-13T11:00:00.000Z";
  const claimThrough = NOW.toISOString();
  const db = makeFakeDb(
    [claimedRow({ id: 1, conta_id: "ws1", event_cursor_at: cursor, event_claim_through: claimThrough })],
    {
      postStatusEvents: [
        {
          id: 10,
          post_id: 100,
          conta_id: "ws1",
          to_status: "enviado_cliente",
          created_at: "2026-08-13T11:30:00.000Z",
          workflow_posts: { cliente_id: 1, status: "enviado_cliente", titulo: "Post A" },
        },
        {
          id: 11,
          post_id: 101,
          conta_id: "ws1",
          to_status: "enviado_cliente",
          created_at: "2026-08-13T11:45:00.000Z",
          workflow_posts: { cliente_id: 1, status: "enviado_cliente", titulo: "Post B" },
        },
      ],
      mensagens: [
        { id: 50, conta_id: "ws1", cliente_id: 1, is_workspace_user: true, created_at: "2026-08-13T11:50:00.000Z" },
      ],
      workspaces: [{ id: "ws1", name: "Agencia X", brand_color: "#ffbf30", logo_url: null }],
    },
  );
  const { deps, sent, auditCalls } = makeDeps(db);
  const r = await runClientEventEmailCron(deps);
  assertEquals(r, { claimed: 1, emailed: 1, skippedNoContent: 0, skippedNoHub: 0, failed: 0, released: 0 });
  assertEquals(sent.length, 1);
  assert(sent[0].html.includes("Post A") && sent[0].html.includes("Post B"), "expected both post titles");
  // event_claimed_at is NOT in the patch (anti-starvation ruling: the
  // success path advances the cursor and clears the LEASE only -- the
  // last-attempt marker survives as the rotation/backoff key).
  assertEquals(db.successCalls, [{ ids: [1], patch: { event_cursor_at: claimThrough, event_claim_through: null } }]);
  assertEquals(db.releaseCalls.length, 0);
  assertEquals(auditCalls.length, 1);
  assertEquals(auditCalls[0].action, "client_event_email_sent");

  // ---- end-to-end assertions on the send payload's binding fields --------
  // `to`: the claimed client's own email.
  assertEquals(sent[0].to, "ana@x.test");
  // RFC 8058 one-click unsubscribe headers, built from the SAME token the
  // handler signs (deterministic HMAC over clienteId=1 + the test's
  // tokenSecret) -- proves Task 5's unsub route gets the exact URL shape
  // it must match, not just "some non-empty headers".
  const expectedToken = await signUnsubToken(1, "test-secret");
  const expectedUnsubUrl = `https://x.supabase.co/functions/v1/client-email-unsub/${expectedToken}`;
  assertEquals(sent[0].headers["List-Unsubscribe"], `<${expectedUnsubUrl}>`);
  assertEquals(sent[0].headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  // Idempotency key: the exported builder over the EXACT deduped composite
  // id set (2 distinct posts -> pse:10 + pse:11, 1 message -> msg:50; no
  // dedupe collapse happens in this fixture, but pinning the builder call
  // proves the key tracks the real ids, not a placeholder or a miscounted set).
  const expectedIdempotencyKey = await buildClientEventIdempotencyKey(1, ["pse:10", "pse:11", "msg:50"]);
  assertEquals(sent[0].idempotencyKey, expectedIdempotencyKey);
});

// --- 3b. From display name: RFC 5322 quoting --------------------------------

/** One claimed client with one pending post, on a workspace named `name`. */
function makeFromNameDb(name: string, clienteId: number) {
  return makeFakeDb(
    [
      claimedRow({
        id: clienteId,
        conta_id: "ws1",
        event_cursor_at: "2026-08-13T00:00:00.000Z",
        event_claim_through: NOW.toISOString(),
      }),
    ],
    {
      postStatusEvents: [
        {
          id: clienteId * 10,
          post_id: clienteId * 100,
          conta_id: "ws1",
          to_status: "enviado_cliente",
          created_at: "2026-08-13T05:00:00.000Z",
          workflow_posts: { cliente_id: clienteId, status: "enviado_cliente", titulo: "Post" },
        },
      ],
      workspaces: [{ id: "ws1", name, brand_color: "#ffbf30", logo_url: null }],
    },
  );
}

Deno.test("From display name strips CR/LF (header injection) and wraps the rest in double quotes", async () => {
  const db = makeFromNameDb("Evil\r\nBcc: attacker@evil.test", 12);
  const { deps, sent } = makeDeps(db);
  const r = await runClientEventEmailCron(deps);
  assertEquals(r.emailed, 1);
  assertEquals(sent.length, 1);
  assert(!sent[0].from.includes("\r"), "carriage return survived into the From header");
  assert(!sent[0].from.includes("\n"), "newline survived into the From header");
  assertEquals(sent[0].from, '"Evil Bcc: attacker@evil.test" <notificacoes@mesaas.com.br>');
});

Deno.test("From display name backslash-escapes a literal backslash and double-quote instead of stripping them", async () => {
  // Actual name value: Weird"Name\Co (one double-quote, one backslash).
  const db = makeFromNameDb('Weird"Name\\Co', 13);
  const { deps, sent } = makeDeps(db);
  const r = await runClientEventEmailCron(deps);
  assertEquals(r.emailed, 1);
  assertEquals(sent[0].from, '"Weird\\"Name\\\\Co" <notificacoes@mesaas.com.br>');
});

// Finding 1 (Codex/opus review): an unquoted display name with an RFC 5322
// "special" (comma, semicolon, parens, ...) parses as more than one address
// -- e.g. "Silva, Souza & Cia" reads as two mailboxes -- and Resend rejects
// the send outright, so every client of that workspace fails every run.
// Quoting (not stripping) is what RFC 5322 itself prescribes for this case.
Deno.test("From display name quotes RFC 5322 specials (comma, ampersand, parens) instead of mangling or rejecting them", async () => {
  const db = makeFromNameDb("Silva, Souza & Cia (Oficial)", 14);
  const { deps, sent } = makeDeps(db);
  const r = await runClientEventEmailCron(deps);
  assertEquals(r.emailed, 1);
  assertEquals(sent[0].from, '"Silva, Souza & Cia (Oficial)" <notificacoes@mesaas.com.br>');
});

// --- 4. NULL cursor: floor = now-72h ------------------------------------------

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
          workflow_posts: { cliente_id: 2, status: "enviado_cliente", titulo: "Old post" },
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

// --- 5. old cursor: GREATEST clamps to now-72h --------------------------------

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
          workflow_posts: { cliente_id: 3, status: "enviado_cliente", titulo: "Too old" },
        },
        // Inside now-72h: must survive.
        {
          id: 31,
          post_id: 301,
          conta_id: "ws1",
          to_status: "enviado_cliente",
          created_at: "2026-08-13T11:00:00.000Z",
          workflow_posts: { cliente_id: 3, status: "enviado_cliente", titulo: "Recent" },
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

// --- 6. dedupe + current-status filter ----------------------------------------

Deno.test("post entered/left enviado_cliente is excluded; a post claimed twice in-window dedupes to its latest transition", async () => {
  const db = makeFakeDb(
    [
      claimedRow({
        id: 4,
        conta_id: "ws1",
        event_cursor_at: "2026-08-13T00:00:00.000Z",
        event_claim_through: NOW.toISOString(),
      }),
    ],
    {
      postStatusEvents: [
        {
          id: 40,
          post_id: 400,
          conta_id: "ws1",
          to_status: "enviado_cliente",
          created_at: "2026-08-13T05:00:00.000Z",
          workflow_posts: { cliente_id: 4, status: "enviado_cliente", titulo: "Dup post (old)" },
        },
        {
          id: 41,
          post_id: 400,
          conta_id: "ws1",
          to_status: "enviado_cliente",
          created_at: "2026-08-13T09:00:00.000Z",
          workflow_posts: { cliente_id: 4, status: "enviado_cliente", titulo: "Dup post (latest)" },
        },
        {
          id: 42,
          post_id: 401,
          conta_id: "ws1",
          to_status: "enviado_cliente",
          created_at: "2026-08-13T06:00:00.000Z",
          workflow_posts: { cliente_id: 4, status: "postado", titulo: "Left status" },
        },
      ],
      workspaces: [{ id: "ws1", name: "Agencia X", brand_color: "#ffbf30", logo_url: null }],
    },
  );
  const { deps, sent } = makeDeps(db);
  const r = await runClientEventEmailCron(deps);
  assertEquals(r.emailed, 1);
  assert(sent[0].html.includes("Dup post (latest)"), "expected the latest transition's title");
  assert(!sent[0].html.includes("Dup post (old)"), "stale duplicate title leaked");
  assert(!sent[0].html.includes("Left status"), "post whose current status left enviado_cliente leaked");
});

// --- 7. message already seen ---------------------------------------------------

Deno.test("message already seen by the client (last_seen_at >= created_at) is excluded", async () => {
  const db = makeFakeDb(
    [
      claimedRow({
        id: 5,
        conta_id: "ws1",
        event_cursor_at: "2026-08-13T00:00:00.000Z",
        event_claim_through: NOW.toISOString(),
      }),
    ],
    {
      postStatusEvents: [
        {
          id: 50,
          post_id: 500,
          conta_id: "ws1",
          to_status: "enviado_cliente",
          created_at: "2026-08-13T05:00:00.000Z",
          workflow_posts: { cliente_id: 5, status: "enviado_cliente", titulo: "Post" },
        },
      ],
      mensagens: [
        { id: 60, conta_id: "ws1", cliente_id: 5, is_workspace_user: true, created_at: "2026-08-13T03:00:00.000Z" }, // before last_seen: excluded
        { id: 61, conta_id: "ws1", cliente_id: 5, is_workspace_user: true, created_at: "2026-08-13T07:00:00.000Z" }, // after last_seen: kept
      ],
      mensagensLastSeen: [{ conta_id: "ws1", cliente_id: 5, last_seen_at: "2026-08-13T04:00:00.000Z" }],
      workspaces: [{ id: "ws1", name: "Agencia X", brand_color: "#ffbf30", logo_url: null }],
    },
  );
  const { deps, sent } = makeDeps(db);
  const r = await runClientEventEmailCron(deps);
  assertEquals(r.emailed, 1);
  assert(sent[0].html.includes("1 mensagens não lidas"), "expected exactly 1 unread message");
});

// --- 8. no content ---------------------------------------------------------------

Deno.test("no content: lease released, cursor intact, skippedNoContent++", async () => {
  const db = makeFakeDb([
    claimedRow({
      id: 6,
      conta_id: "ws1",
      event_cursor_at: "2026-08-13T00:00:00.000Z",
      event_claim_through: NOW.toISOString(),
    }),
  ]);
  const { deps, sent } = makeDeps(db);
  const r = await runClientEventEmailCron(deps);
  assertEquals(r.skippedNoContent, 1);
  assertEquals(sent.length, 0);
  assertEquals(db.releaseCalls, [{ ids: [6], patch: { event_claim_through: null } }]);
  assertEquals(db.successCalls.length, 0);
});

// --- 9. empty hub URL --------------------------------------------------------------

Deno.test("empty hub URL: lease released, cursor intact, skippedNoHub++, no send", async () => {
  const db = makeFakeDb(
    [
      claimedRow({
        id: 7,
        conta_id: "ws1",
        event_cursor_at: "2026-08-13T00:00:00.000Z",
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
          created_at: "2026-08-13T05:00:00.000Z",
          workflow_posts: { cliente_id: 7, status: "enviado_cliente", titulo: "Post" },
        },
      ],
    },
  );
  const { deps, sent } = makeDeps(db, { resolveHubUrl: () => Promise.resolve("") });
  const r = await runClientEventEmailCron(deps);
  assertEquals(r.skippedNoHub, 1);
  assertEquals(sent.length, 0);
  assertEquals(db.releaseCalls, [{ ids: [7], patch: { event_claim_through: null } }]);
  assertEquals(db.successCalls.length, 0);
});

// --- 10. send failure -----------------------------------------------------------------

Deno.test("send failure: lease released, cursor intact, failed++, report() called", async () => {
  const db = makeFakeDb(
    [
      claimedRow({
        id: 8,
        conta_id: "ws1",
        event_cursor_at: "2026-08-13T00:00:00.000Z",
        event_claim_through: NOW.toISOString(),
      }),
    ],
    {
      postStatusEvents: [
        {
          id: 80,
          post_id: 800,
          conta_id: "ws1",
          to_status: "enviado_cliente",
          created_at: "2026-08-13T05:00:00.000Z",
          workflow_posts: { cliente_id: 8, status: "enviado_cliente", titulo: "Post" },
        },
      ],
      workspaces: [{ id: "ws1", name: "Agencia X", brand_color: "#ffbf30", logo_url: null }],
    },
  );
  const reportCalls: Array<{ failed: number; errors: Array<{ accountId?: string; error: string }> }> = [];
  const { deps } = makeDeps(db, {
    sendEmail: () => Promise.reject(new Error("resend down")),
    report: (detail) => {
      reportCalls.push(detail);
      return Promise.resolve();
    },
  });
  const r = await runClientEventEmailCron(deps);
  assertEquals(r.failed, 1);
  assertEquals(db.releaseCalls, [{ ids: [8], patch: { event_claim_through: null } }]);
  assertEquals(db.successCalls.length, 0);
  assertEquals(reportCalls.length, 1);
  assertEquals(reportCalls[0].failed, 1);
  assertEquals(reportCalls[0].errors[0].accountId, "8");
  assert(reportCalls[0].errors[0].error.includes("resend down"), "expected the send error to propagate to report()");
});

// --- 11. idempotency key ----------------------------------------------------------------

Deno.test("idempotency key: stable regardless of id order, sensitive to the exact id set", async () => {
  const k1 = await buildClientEventIdempotencyKey(1, ["pse:10", "msg:5", "pse:2"]);
  const k2 = await buildClientEventIdempotencyKey(1, ["msg:5", "pse:2", "pse:10"]);
  assertEquals(k1, k2);
  assert(k1.startsWith("client-events:1:"), "expected the client-events:<id>: prefix");

  const k3 = await buildClientEventIdempotencyKey(1, ["pse:10", "msg:5"]);
  assert(k1 !== k3, "different id sets must not collide");

  const k4 = await buildClientEventIdempotencyKey(2, ["pse:10", "msg:5", "pse:2"]);
  assert(k1 !== k4, "different cliente ids must not collide");
});

// --- 12. deadline -----------------------------------------------------------------------

Deno.test("60s deadline: remaining clients get their lease released without a send", async () => {
  const db = makeFakeDb(
    [
      claimedRow({
        id: 9,
        conta_id: "ws1",
        event_cursor_at: "2026-08-13T00:00:00.000Z",
        event_claim_through: NOW.toISOString(),
      }),
      claimedRow({
        id: 10,
        conta_id: "ws1",
        event_cursor_at: "2026-08-13T00:00:00.000Z",
        event_claim_through: NOW.toISOString(),
      }),
      claimedRow({
        id: 11,
        conta_id: "ws1",
        event_cursor_at: "2026-08-13T00:00:00.000Z",
        event_claim_through: NOW.toISOString(),
      }),
    ],
    {
      postStatusEvents: [
        {
          id: 90,
          post_id: 900,
          conta_id: "ws1",
          to_status: "enviado_cliente",
          created_at: "2026-08-13T05:00:00.000Z",
          workflow_posts: { cliente_id: 9, status: "enviado_cliente", titulo: "Post" },
        },
      ],
      workspaces: [{ id: "ws1", name: "Agencia X", brand_color: "#ffbf30", logo_url: null }],
    },
  );
  let i = 0;
  const nowMs = () => [0, 0, 70_000][Math.min(i++, 2)];
  const { deps, sent } = makeDeps(db, { nowMs });
  const r = await runClientEventEmailCron(deps);
  assertEquals(r.emailed, 1);
  assertEquals(r.released, 2);
  assertEquals(sent.length, 1);
  assertEquals(db.releaseCalls.length, 1);
  assertEquals(db.releaseCalls[0].ids.sort(), [10, 11]);
  assertEquals(db.releaseCalls[0].patch, { event_claim_through: null });
});

// --- 13. events/messages query cap: safe cursor advance, oldest-first drain --------------
//
// Codex review (PR #437, P2): PostgREST itself caps an unbounded select
// (commonly at 1000 rows). Without an explicit `.limit()` the handler had no
// way to tell "the window really only had this many events" apart from
// "truncated" -- and advancing event_cursor_at to claim_through regardless
// silently dropped whatever the cap excluded, forever.
//
// A first version of this fix ordered DESCENDING and advanced the cursor to
// the OLDEST fetched row -- which strands the un-fetched OLDER remainder
// below the new cursor forever (every future window only moves forward).
// That was caught in review before shipping: the corrected design orders
// ASCENDING (oldest first) and advances only to the NEWEST fetched row, so
// the un-fetched NEWER remainder is exactly what the next tick's window
// covers. The first test below proves both halves of that: the capped
// tick's cursor stops short of claim_through, and a second, independent run
// (simulating the next tick) picks up precisely the remainder the first
// tick couldn't reach.

Deno.test("events query hits the cap: cursor advances to the newest fetched row, and the next tick drains the remainder", async () => {
  const clienteId = 15;
  const floorMs = new Date("2026-08-10T12:00:00.000Z").getTime(); // NOW - 72h
  const allEvents: Row[] = [];
  for (let i = 0; i < 1500; i++) {
    allEvents.push({
      id: 10_000 + i,
      post_id: 20_000 + i,
      conta_id: "ws1",
      to_status: "enviado_cliente",
      created_at: new Date(floorMs + (i + 1) * 60_000).toISOString(), // 1 min apart, oldest (i=0) first
      workflow_posts: { cliente_id: clienteId, status: "enviado_cliente", titulo: `Post ${i}` },
    });
  }
  const ws = [{ id: "ws1", name: "Agencia X", brand_color: "#ffbf30", logo_url: null }];

  // ---- tick 1: 1500 candidates, cap 1000 -- ascending order fetches i=0..999 ----
  const tick1SafeUpperIso = allEvents[999].created_at as string; // newest of the fetched (oldest) chunk
  const claimThrough1 = NOW.toISOString();
  const db1 = makeFakeDb(
    [claimedRow({ id: clienteId, conta_id: "ws1", event_cursor_at: null, event_claim_through: claimThrough1 })],
    { postStatusEvents: allEvents, workspaces: ws },
  );
  const { deps: deps1 } = makeDeps(db1);
  const r1 = await runClientEventEmailCron(deps1);
  assertEquals(r1.emailed, 1);
  assertEquals(db1.successCalls.length, 1);
  assert(
    db1.successCalls[0].patch.event_cursor_at !== claimThrough1,
    "tick 1's cursor must NOT jump to claim_through -- the events query was capped",
  );
  assertEquals(db1.successCalls[0].patch, { event_cursor_at: tick1SafeUpperIso, event_claim_through: null });

  // ---- tick 2: same client, cursor now at tick 1's boundary, 15 min later ----
  // The remaining 500 events (i=1000..1499) all fall inside this window and
  // are under the cap this time, so the cursor reaches claim_through --
  // proving the remainder tick 1 couldn't reach is picked up, not stranded.
  const claimThrough2 = new Date(NOW.getTime() + 15 * 60_000).toISOString();
  const db2 = makeFakeDb(
    [
      claimedRow({
        id: clienteId,
        conta_id: "ws1",
        event_cursor_at: tick1SafeUpperIso,
        event_claim_through: claimThrough2,
      }),
    ],
    { postStatusEvents: allEvents, workspaces: ws }, // same full candidate set -- the query's own gt() filters out what tick 1 already consumed
  );
  const { deps: deps2, sent: sent2 } = makeDeps(db2, { now: () => new Date(claimThrough2) });
  const r2 = await runClientEventEmailCron(deps2);
  assertEquals(r2.emailed, 1);
  assertEquals(db2.successCalls, [
    { ids: [clienteId], patch: { event_cursor_at: claimThrough2, event_claim_through: null } },
  ]);
  // The 500-post remainder (i=1000..1499) actually landed in tick 2's digest:
  // its oldest (first-encountered) post renders directly, and the render cap
  // folds the other 480 into the overflow line -- both prove all 500 came
  // through, not just a lucky subset.
  assert(sent2[0].html.includes("Post 1000"), "expected the remainder's oldest post in tick 2's digest");
  assert(sent2[0].html.includes("e mais 480 posts aguardando aprovação."), "expected all 500 remainder posts accounted for");
});

// --- 14. both queries capped: min of the two bounds ----------------------------------------

Deno.test("both events and messages hit the cap: cursor advances to the more conservative (min) of the two bounds", async () => {
  const clienteId = 16;
  const floorMs = new Date("2026-08-10T12:00:00.000Z").getTime(); // NOW - 72h
  const capEvents: Row[] = [];
  for (let i = 0; i < 1000; i++) {
    capEvents.push({
      id: 30_000 + i,
      post_id: 40_000 + i,
      conta_id: "ws1",
      to_status: "enviado_cliente",
      created_at: new Date(floorMs + 10 * 60_000 + i * 2 * 60_000).toISOString(), // starts at floor+10min, 2 min apart -- drains FURTHER
      workflow_posts: { cliente_id: clienteId, status: "enviado_cliente", titulo: `Post ${i}` },
    });
  }
  const eventsSafeBound = capEvents[999].created_at as string; // newest fetched: floor + 2008 min

  const capMessages: Row[] = [];
  for (let i = 0; i < 1000; i++) {
    capMessages.push({
      id: 50_000 + i,
      conta_id: "ws1",
      cliente_id: clienteId,
      is_workspace_user: true,
      created_at: new Date(floorMs + 3 * 60_000 + i * 60_000).toISOString(), // starts at floor+3min, 1 min apart -- drains LESS far
    });
  }
  const messagesSafeBound = capMessages[999].created_at as string; // newest fetched: floor + 1002 min -- the more conservative bound

  const db = makeFakeDb(
    [claimedRow({ id: clienteId, conta_id: "ws1", event_cursor_at: null, event_claim_through: NOW.toISOString() })],
    {
      postStatusEvents: capEvents,
      mensagens: capMessages,
      workspaces: [{ id: "ws1", name: "Agencia X", brand_color: "#ffbf30", logo_url: null }],
    },
  );
  const { deps } = makeDeps(db);
  const r = await runClientEventEmailCron(deps);
  assertEquals(r.emailed, 1);
  assert(
    messagesSafeBound < eventsSafeBound,
    "test fixture sanity: messages must be the query that drained LESS far (the more conservative bound)",
  );
  assertEquals(db.successCalls, [
    { ids: [clienteId], patch: { event_cursor_at: messagesSafeBound, event_claim_through: null } },
  ]);
});

// --- 14b. dedupe tiebreak ------------------------------------------------------------------

Deno.test("dedupe tiebreak: two transitions for the same post at the identical timestamp resolve deterministically by id", async () => {
  const clienteId = 17;
  const tiedCreatedAt = "2026-08-13T05:00:00.000Z";
  const db = makeFakeDb(
    [
      claimedRow({
        id: clienteId,
        conta_id: "ws1",
        event_cursor_at: "2026-08-13T00:00:00.000Z",
        event_claim_through: NOW.toISOString(),
      }),
    ],
    {
      // Same post_id, same created_at, different ids, inserted OUT of id
      // order to prove the sort is real (not just array/insertion order).
      postStatusEvents: [
        {
          id: 900,
          post_id: 8000,
          conta_id: "ws1",
          to_status: "enviado_cliente",
          created_at: tiedCreatedAt,
          workflow_posts: { cliente_id: clienteId, status: "enviado_cliente", titulo: "Version B (higher id)" },
        },
        {
          id: 100,
          post_id: 8000,
          conta_id: "ws1",
          to_status: "enviado_cliente",
          created_at: tiedCreatedAt,
          workflow_posts: { cliente_id: clienteId, status: "enviado_cliente", titulo: "Version A (lower id)" },
        },
      ],
      workspaces: [{ id: "ws1", name: "Agencia X", brand_color: "#ffbf30", logo_url: null }],
    },
  );
  const { deps, sent } = makeDeps(db);
  const r = await runClientEventEmailCron(deps);
  assertEquals(r.emailed, 1);
  // created_at ASC + id ASC tiebreak: id=100 sorts before id=900, so the
  // Map-overwrite dedupe processes id=100 first, then id=900 -- id=900 (the
  // higher id, i.e. the LATER transition at the tied timestamp) wins.
  assert(sent[0].html.includes("Version B (higher id)"), "expected the higher-id (later) version to win the dedupe");
  assert(!sent[0].html.includes("Version A (lower id)"), "expected the lower-id (earlier) version to be superseded");
});

// --- 15. tie cluster straddling the cap ----------------------------------------------------
//
// Scoped re-review of rounds 3-4 (PR #437): the cap cuts on a COMPOSITE
// (created_at, id), but a `created_at`-only boundary is used for the
// gt() cursor check next tick. A transaction-stable now() makes it common
// for several rows (e.g. bulk-approving a batch of posts at once) to share
// the exact same created_at -- if the cap happens to cut through the MIDDLE
// of that tied group, the excluded siblings can never satisfy
// `gt(created_at, boundary)` on any future tick and are stranded forever.
// The repo already names and fixes this exact trap for a different query
// (composite keyset cursor, mensagens_consolidadas.sql:253-258).

Deno.test("tie cluster straddling the cap: all siblings delivered via one supplementary fetch, cursor lands on the tied timestamp, tick 2 does not repeat them", async () => {
  const clienteId = 19;
  const floorMs = new Date("2026-08-10T12:00:00.000Z").getTime(); // NOW - 72h
  const tiedTsMs = floorMs + 995 * 60_000;
  const tiedTsIso = new Date(tiedTsMs).toISOString();

  // 994 distinct-timestamp events (rows 1-994).
  const preTie: Row[] = [];
  for (let i = 0; i < 994; i++) {
    preTie.push({
      id: 10_000 + i,
      post_id: 20_000 + i,
      conta_id: "ws1",
      to_status: "enviado_cliente",
      created_at: new Date(floorMs + (i + 1) * 60_000).toISOString(),
      workflow_posts: { cliente_id: clienteId, status: "enviado_cliente", titulo: `Pre ${i}` },
    });
  }
  // 11 events (rows 995-1005) sharing the EXACT same created_at -- the cap
  // (limit 1000) cuts through the middle of this group. Ids are scrambled
  // in the array to prove the id-ascending tiebreak is a real sort, not
  // array/insertion order.
  const tiedIds = [90_005, 90_002, 90_009, 90_000, 90_007, 90_003, 90_008, 90_001, 90_006, 90_004, 90_010];
  const tied: Row[] = tiedIds.map((id, j) => ({
    id,
    post_id: 30_000 + j,
    conta_id: "ws1",
    to_status: "enviado_cliente",
    created_at: tiedTsIso,
    workflow_posts: { cliente_id: clienteId, status: "enviado_cliente", titulo: `Tied ${j}` },
  }));
  // 5 more events strictly AFTER the tied timestamp -- must NOT be part of
  // tick 1's digest, and must be exactly what tick 2 delivers.
  const postTie: Row[] = [];
  for (let k = 0; k < 5; k++) {
    postTie.push({
      id: 40_000 + k,
      post_id: 50_000 + k,
      conta_id: "ws1",
      to_status: "enviado_cliente",
      created_at: new Date(tiedTsMs + (k + 1) * 60_000).toISOString(),
      workflow_posts: { cliente_id: clienteId, status: "enviado_cliente", titulo: `Post-tie ${k}` },
    });
  }
  const allEvents = [...preTie, ...tied, ...postTie];
  const ws = [{ id: "ws1", name: "Agencia X", brand_color: "#ffbf30", logo_url: null }];

  // ---- tick 1: primary fetch caps at 1000 (994 pre-tie + the 6 tied rows
  // with the lowest ids); the supplementary tie-completion fetch pulls in
  // the other 5 tied rows (higher ids), completing the group of 11. ----
  const claimThrough1 = NOW.toISOString();
  const db1 = makeFakeDb(
    [claimedRow({ id: clienteId, conta_id: "ws1", event_cursor_at: null, event_claim_through: claimThrough1 })],
    { postStatusEvents: allEvents, workspaces: ws },
  );
  const { deps: deps1, sent: sent1 } = makeDeps(db1);
  const r1 = await runClientEventEmailCron(deps1);
  assertEquals(r1.emailed, 1);
  assertEquals(db1.successCalls, [
    { ids: [clienteId], patch: { event_cursor_at: tiedTsIso, event_claim_through: null } },
  ]);
  // 994 pre-tie + all 11 tied = 1005 pending posts -- none of the 11 tied
  // siblings lost to the cap, none of the 5 post-tie posts leaked in early.
  // The overflow line's count is the sharpest signal available: it's wrong
  // the instant a single post goes missing OR shows up early.
  assert(
    sent1[0].html.includes("e mais 985 posts aguardando aprovação."),
    "expected exactly 1005 pending posts (994 pre-tie + all 11 tied)",
  );
  const expectedIds1 = [...preTie, ...tied].map((e) => `pse:${e.id}`);
  const expectedKey1 = await buildClientEventIdempotencyKey(clienteId, expectedIds1);
  assertEquals(sent1[0].idempotencyKey, expectedKey1);

  // ---- tick 2: same client, cursor now at the tied timestamp, 15 min later ----
  const claimThrough2 = new Date(NOW.getTime() + 15 * 60_000).toISOString();
  const db2 = makeFakeDb(
    [
      claimedRow({
        id: clienteId,
        conta_id: "ws1",
        event_cursor_at: tiedTsIso,
        event_claim_through: claimThrough2,
      }),
    ],
    { postStatusEvents: allEvents, workspaces: ws },
  );
  const { deps: deps2, sent: sent2 } = makeDeps(db2, { now: () => new Date(claimThrough2) });
  const r2 = await runClientEventEmailCron(deps2);
  assertEquals(r2.emailed, 1);
  assertEquals(db2.successCalls, [
    { ids: [clienteId], patch: { event_cursor_at: claimThrough2, event_claim_through: null } },
  ]);
  assert(
    sent2[0].html.includes("Post-tie 0") && sent2[0].html.includes("Post-tie 4"),
    "expected all 5 post-tie posts in tick 2",
  );
  assert(!sent2[0].html.includes("Pre 0"), "tick 1's pre-tie content must not repeat in tick 2");
  assert(!sent2[0].html.includes("Tied 0"), "tick 1's tied content must not repeat in tick 2");
  const expectedIds2 = postTie.map((e) => `pse:${e.id}`);
  const expectedKey2 = await buildClientEventIdempotencyKey(clienteId, expectedIds2);
  assertEquals(sent2[0].idempotencyKey, expectedKey2);
});

// --- 16. asymmetric cap: trim-to-bound prevents cross-source duplicate delivery -----------
//
// Scoped re-review of rounds 3-4 (PR #437): when only ONE of the two
// queries (events vs. messages) hits the cap, the OTHER query's items newer
// than the folded safe bound were still being sent THIS tick (nothing
// trimmed them), while the cursor only advanced to the more conservative
// bound -- the next tick's window still covers those items and would
// re-mail them. Here messages caps (1000, under-dense window would exceed
// it) and events stays comfortably under cap, but two of the three events
// sit AFTER messages' safe bound and must be held back to tick 2.

Deno.test("asymmetric cap (messages caps, events under): tick 2 does not repeat tick 1's event items", async () => {
  const clienteId = 20;
  const floorMs = new Date("2026-08-10T12:00:00.000Z").getTime(); // NOW - 72h

  // Events: comfortably under EVENTS_QUERY_CAP, but two of the three sit
  // well past where the messages query will cap.
  const events: Row[] = [
    {
      id: 70_001,
      post_id: 80_001,
      conta_id: "ws1",
      to_status: "enviado_cliente",
      created_at: new Date(floorMs + 2 * 60_000).toISOString(), // floor + 2 min
      workflow_posts: { cliente_id: clienteId, status: "enviado_cliente", titulo: "Event Early" },
    },
    {
      id: 70_002,
      post_id: 80_002,
      conta_id: "ws1",
      to_status: "enviado_cliente",
      created_at: new Date(floorMs + 1500 * 60_000).toISOString(), // floor + 1500 min
      workflow_posts: { cliente_id: clienteId, status: "enviado_cliente", titulo: "Event Middle" },
    },
    {
      id: 70_003,
      post_id: 80_003,
      conta_id: "ws1",
      to_status: "enviado_cliente",
      created_at: new Date(floorMs + 2000 * 60_000).toISOString(), // floor + 2000 min
      workflow_posts: { cliente_id: clienteId, status: "enviado_cliente", titulo: "Event Late" },
    },
  ];

  // Messages: exactly EVENTS_QUERY_CAP (1000), distinct timestamps 1 min
  // apart starting at floor+1min -- caps at floor+1000min, well before
  // "Event Middle"/"Event Late" but after "Event Early".
  const messages: Row[] = [];
  for (let i = 0; i < 1000; i++) {
    messages.push({
      id: 95_000 + i,
      conta_id: "ws1",
      cliente_id: clienteId,
      is_workspace_user: true,
      created_at: new Date(floorMs + (i + 1) * 60_000).toISOString(),
    });
  }
  const messagesSafeBoundIso = messages[999].created_at as string; // floor + 1000 min
  const ws = [{ id: "ws1", name: "Agencia X", brand_color: "#ffbf30", logo_url: null }];

  // ---- tick 1 ----
  const claimThrough1 = NOW.toISOString();
  const db1 = makeFakeDb(
    [claimedRow({ id: clienteId, conta_id: "ws1", event_cursor_at: null, event_claim_through: claimThrough1 })],
    { postStatusEvents: events, mensagens: messages, workspaces: ws },
  );
  const { deps: deps1, sent: sent1 } = makeDeps(db1);
  const r1 = await runClientEventEmailCron(deps1);
  assertEquals(r1.emailed, 1);
  // The cursor advances to messages' (the only capped query's) bound --
  // events never capped, so it contributes nothing to the fold.
  assertEquals(db1.successCalls, [
    { ids: [clienteId], patch: { event_cursor_at: messagesSafeBoundIso, event_claim_through: null } },
  ]);
  // "Event Early" (floor+2min) is within the bound and ships; "Event
  // Middle"/"Event Late" (floor+1500/2000min) are past the bound -- trimmed
  // out of THIS digest even though the (uncapped) events query fetched them.
  assert(sent1[0].html.includes("Event Early"), "expected the in-bound event in tick 1");
  assert(!sent1[0].html.includes("Event Middle"), "expected the past-bound event trimmed out of tick 1");
  assert(!sent1[0].html.includes("Event Late"), "expected the past-bound event trimmed out of tick 1");

  // ---- tick 2: same client, cursor now at messages' bound, 15 min later ----
  const claimThrough2 = new Date(NOW.getTime() + 15 * 60_000).toISOString();
  const db2 = makeFakeDb(
    [
      claimedRow({
        id: clienteId,
        conta_id: "ws1",
        event_cursor_at: messagesSafeBoundIso,
        event_claim_through: claimThrough2,
      }),
    ],
    { postStatusEvents: events, mensagens: messages, workspaces: ws },
  );
  const { deps: deps2, sent: sent2 } = makeDeps(db2, { now: () => new Date(claimThrough2) });
  const r2 = await runClientEventEmailCron(deps2);
  assertEquals(r2.emailed, 1);
  // Neither query caps this time (messages: none left past the old bound;
  // events: only the 2 remaining) -- cursor reaches claim_through directly.
  assertEquals(db2.successCalls, [
    { ids: [clienteId], patch: { event_cursor_at: claimThrough2, event_claim_through: null } },
  ]);
  assert(sent2[0].html.includes("Event Middle") && sent2[0].html.includes("Event Late"), "expected the held-back events in tick 2");
  assert(!sent2[0].html.includes("Event Early"), "tick 1's already-delivered event must not repeat in tick 2");
});

// --- 17. handler auth --------------------------------------------------------------------

Deno.test("handler rejects a wrong cron secret with 401 before any db call", async () => {
  const handler = createClientEventEmailCronHandler({
    cronSecret: "seg",
    timingSafeEqual: (a, b) => a === b,
    run: () => Promise.resolve(new Response("ok")),
  });
  const res = await handler(new Request("https://x.test/", { headers: { "x-cron-secret": "no" } }));
  assertEquals(res.status, 401);
});
