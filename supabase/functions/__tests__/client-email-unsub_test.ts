import { assert, assertEquals } from "./assert.ts";
import {
  type ClientEmailUnsubDb,
  createClientEmailUnsubHandler,
} from "../client-email-unsub/handler.ts";

const NOW = new Date("2026-09-02T12:00:00.000Z");
const SECRET = "test-secret";

// ─── minimal fakes ──────────────────────────────────────────────────────────

/**
 * `rows[id] = contaId` when the row exists (default "conta-1" for any id not
 * listed, so existing tests need no changes); `rows[id] = null` simulates a
 * client deleted between token issuance and click -- the update matches zero
 * rows, so `.select("conta_id")` resolves with an empty array, never an
 * error (mirrors real PostgREST: an UPDATE matching nothing is not a DB
 * error).
 */
function makeFakeDb(rows: Record<number, string | null> = {}) {
  const updateCalls: Array<{ table: string; patch: Record<string, unknown>; id: unknown }> = [];
  const db: ClientEmailUnsubDb = {
    from(table: string) {
      return {
        update(patch: Record<string, unknown>) {
          return {
            eq(_column: string, value: unknown) {
              updateCalls.push({ table, patch, id: value });
              return {
                select(_columns: string) {
                  const id = value as number;
                  const contaId = Object.prototype.hasOwnProperty.call(rows, id) ? rows[id] : "conta-1";
                  const data = contaId === null ? [] : [{ conta_id: contaId }];
                  return Promise.resolve({ data, error: null });
                },
              };
            },
          };
        },
      };
    },
  } as unknown as ClientEmailUnsubDb;
  return { db, updateCalls };
}

/** token -> clienteId map; unknown tokens verify to null (invalid/malformed). */
function makeVerifyToken(map: Record<string, number | null>) {
  return (token: string, secret: string): Promise<number | null> => {
    assertEquals(secret, SECRET);
    return Promise.resolve(Object.prototype.hasOwnProperty.call(map, token) ? map[token] : null);
  };
}

function makeAuditLog() {
  const calls: Array<Record<string, unknown>> = [];
  const fn = (entry: Record<string, unknown>): Promise<void> => {
    calls.push(entry);
    return Promise.resolve();
  };
  return { fn, calls };
}

const cors = () => ({ "Access-Control-Allow-Origin": "https://app.mesaas.com" });

function makeHandler(opts: {
  db: ClientEmailUnsubDb;
  tokens: Record<string, number | null>;
  auditLog?: (entry: Record<string, unknown>) => Promise<void>;
}) {
  const audit = opts.auditLog ?? makeAuditLog().fn;
  return createClientEmailUnsubHandler({
    db: opts.db,
    verifyToken: makeVerifyToken(opts.tokens),
    tokenSecret: SECRET,
    now: () => NOW,
    auditLog: audit,
    buildCorsHeaders: cors,
  });
}

function req(method: string, token: string): Request {
  return new Request(`https://x.test/functions/v1/client-email-unsub/${token}`, { method });
}

// ─── GET: confirms, never mutates ───────────────────────────────────────────

Deno.test("client-email-unsub: GET with valid token returns 200 + form, db untouched", async () => {
  const { db, updateCalls } = makeFakeDb();
  const handler = makeHandler({ db, tokens: { "good-token": 42 } });

  const res = await handler(req("GET", "good-token"));
  const body = await res.text();

  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "text/html; charset=utf-8");
  assert(body.includes('<form method="post">'), "expected a POST form in the confirmation page");
  assertEquals(updateCalls.length, 0);
});

Deno.test("client-email-unsub: GET with invalid token returns 404 generic page, db untouched", async () => {
  const { db, updateCalls } = makeFakeDb();
  const handler = makeHandler({ db, tokens: {} }); // "bad-token" not in map -> null

  const res = await handler(req("GET", "bad-token"));
  const body = await res.text();

  assertEquals(res.status, 404);
  assertEquals(res.headers.get("Content-Type"), "text/html; charset=utf-8");
  assert(!body.includes("bad-token"), "404 page must not leak the token or any error detail");
  assertEquals(updateCalls.length, 0);
});

// ─── POST: mutates + audits ─────────────────────────────────────────────────

Deno.test("client-email-unsub: POST with valid token updates the 2 fields + audits + 200", async () => {
  const { db, updateCalls } = makeFakeDb();
  const audit = makeAuditLog();
  const handler = makeHandler({ db, tokens: { "good-token": 42 }, auditLog: audit.fn });

  const res = await handler(req("POST", "good-token"));
  const body = await res.text();

  assertEquals(res.status, 200);
  assert(body.includes("Pronto"), "expected the done page");

  assertEquals(updateCalls.length, 1);
  assertEquals(updateCalls[0].table, "clientes");
  assertEquals(updateCalls[0].id, 42);
  assertEquals(updateCalls[0].patch, {
    send_event_email: false,
    event_email_unsub_at: NOW.toISOString(),
  });

  assertEquals(audit.calls.length, 1);
  assertEquals(audit.calls[0].action, "client_event_email_unsub");
  assertEquals(audit.calls[0].resource_type, "cliente");
  assertEquals(audit.calls[0].resource_id, "42");
  assertEquals(audit.calls[0].conta_id, "conta-1");
});

Deno.test("client-email-unsub: POST for a client deleted since token issuance -- 200 page, no audit, no throw", async () => {
  // update matches zero rows (client gone) -- select("conta_id") resolves []
  const { db, updateCalls } = makeFakeDb({ 42: null });
  const audit = makeAuditLog();
  const handler = makeHandler({ db, tokens: { "good-token": 42 }, auditLog: audit.fn });

  const res = await handler(req("POST", "good-token"));
  const body = await res.text();

  assertEquals(res.status, 200);
  assert(body.includes("Pronto"), "expected the generic done page, not an error page");
  assertEquals(updateCalls.length, 1); // the update was attempted
  assertEquals(audit.calls.length, 0); // nothing was updated -- nothing to audit
});

Deno.test("client-email-unsub: POST replay is idempotent -- 200 again, update runs again harmlessly", async () => {
  const { db, updateCalls } = makeFakeDb();
  const audit = makeAuditLog();
  const handler = makeHandler({ db, tokens: { "good-token": 42 }, auditLog: audit.fn });

  const first = await handler(req("POST", "good-token"));
  const second = await handler(req("POST", "good-token"));

  assertEquals(first.status, 200);
  assertEquals(second.status, 200);
  assertEquals(updateCalls.length, 2);
  assertEquals(audit.calls.length, 2);
});

Deno.test("client-email-unsub: POST with invalid token returns 404, never mutates", async () => {
  const { db, updateCalls } = makeFakeDb();
  const audit = makeAuditLog();
  const handler = makeHandler({ db, tokens: {}, auditLog: audit.fn });

  const res = await handler(req("POST", "adulterated-token"));

  assertEquals(res.status, 404);
  assertEquals(updateCalls.length, 0);
  assertEquals(audit.calls.length, 0);
});

// ─── clienteId 0 is a VALID id -- only `=== null` means invalid ────────────

Deno.test("client-email-unsub: a token that verifies to clienteId 0 is treated as VALID (GET)", async () => {
  const { db, updateCalls } = makeFakeDb();
  const handler = makeHandler({ db, tokens: { "zero-token": 0 } });

  const res = await handler(req("GET", "zero-token"));

  assertEquals(res.status, 200);
  assertEquals(updateCalls.length, 0);
});

Deno.test("client-email-unsub: a token that verifies to clienteId 0 is treated as VALID (POST mutates id 0)", async () => {
  const { db, updateCalls } = makeFakeDb();
  const audit = makeAuditLog();
  const handler = makeHandler({ db, tokens: { "zero-token": 0 }, auditLog: audit.fn });

  const res = await handler(req("POST", "zero-token"));

  assertEquals(res.status, 200);
  assertEquals(updateCalls.length, 1);
  assertEquals(updateCalls[0].id, 0);
  assertEquals(audit.calls[0].resource_id, "0");
});

// ─── method guard ────────────────────────────────────────────────────────

Deno.test("client-email-unsub: PUT returns 405", async () => {
  const { db, updateCalls } = makeFakeDb();
  const handler = makeHandler({ db, tokens: { "good-token": 42 } });

  const res = await handler(req("PUT", "good-token"));

  assertEquals(res.status, 405);
  assertEquals(updateCalls.length, 0);
});
