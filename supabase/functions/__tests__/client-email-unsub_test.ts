import { assert, assertEquals } from "./assert.ts";
import {
  type ClientEmailUnsubDb,
  createClientEmailUnsubHandler,
  createDescadastrarConvidado,
  type DescadastrarConvidadoDb,
} from "../client-email-unsub/handler.ts";
import type { UnsubAlvo } from "../_shared/client-event-email.ts";

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

/** token -> clienteId (a bare number) or a full `{ tipo, id }` target;
 * unknown tokens verify to null (invalid/malformed). */
function makeVerifyToken(map: Record<string, number | UnsubAlvo | null>) {
  return (token: string, secret: string): Promise<UnsubAlvo | null> => {
    assertEquals(secret, SECRET);
    const v = Object.prototype.hasOwnProperty.call(map, token) ? map[token] : null;
    return Promise.resolve(typeof v === "number" ? { tipo: "cliente" as const, id: v } : v);
  };
}

/** Fake `descadastrarConvidado`: `rows[id] = contaId`, `null` = id unknown to every table; throws when `fail`. */
function makeDescadastrar(rows: Record<number, string | null> = {}, fail = false) {
  const calls: number[] = [];
  const fn = (id: number): Promise<{ conta_id: string } | null> => {
    calls.push(id);
    if (fail) return Promise.reject(new Error("db down"));
    const conta = Object.prototype.hasOwnProperty.call(rows, id) ? rows[id] : "conta-g";
    return Promise.resolve(conta === null ? null : { conta_id: conta });
  };
  return { fn, calls };
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
  tokens: Record<string, number | UnsubAlvo | null>;
  auditLog?: (entry: Record<string, unknown>) => Promise<void>;
  descadastrar?: (id: number) => Promise<{ conta_id: string } | null>;
}) {
  const audit = opts.auditLog ?? makeAuditLog().fn;
  return createClientEmailUnsubHandler({
    db: opts.db,
    verifyToken: makeVerifyToken(opts.tokens),
    descadastrarConvidado: opts.descadastrar ?? makeDescadastrar().fn,
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

// ─── guest tokens ({g}, Agenda sub-project 4) ───────────────────────────────

const GUEST: UnsubAlvo = { tipo: "convidado", id: 77 };

Deno.test("client-email-unsub: GET with a guest token renders the Agenda confirmation, never mutates", async () => {
  const { db, updateCalls } = makeFakeDb();
  const desc = makeDescadastrar();
  const handler = makeHandler({ db, tokens: { "g-token": GUEST }, descadastrar: desc.fn });

  const res = await handler(req("GET", "g-token"));
  const body = await res.text();

  assertEquals(res.status, 200);
  assertEquals(res.headers.get("Content-Type"), "text/html; charset=utf-8");
  assert(body.includes('<form method="post">'));
  assert(body.includes("convites e avisos de eventos"), "guest copy");
  assert(!body.includes("pendências"), "no Hub digest copy for a guest");
  assert(!body.includes("—"));
  assertEquals(updateCalls.length, 0);
  assertEquals(desc.calls.length, 0);
});

Deno.test("client-email-unsub: client GET keeps the pendências copy", async () => {
  const { db } = makeFakeDb();
  const handler = makeHandler({ db, tokens: { "good-token": 42 } });
  const body = await (await handler(req("GET", "good-token"))).text();
  assert(body.includes("pendências"));
});

Deno.test("client-email-unsub: POST (one-click, bodyless) with a guest token blocks the address and audits; clientes untouched", async () => {
  const { db, updateCalls } = makeFakeDb();
  const desc = makeDescadastrar();
  const audit = makeAuditLog();
  const handler = makeHandler({ db, tokens: { "g-token": GUEST }, descadastrar: desc.fn, auditLog: audit.fn });

  const res = await handler(req("POST", "g-token"));
  const body = await res.text();

  assertEquals(res.status, 200);
  assert(body.includes("Pronto"));
  assertEquals(desc.calls, [77]);
  assertEquals(updateCalls.length, 0);
  assertEquals(audit.calls, [{
    conta_id: "conta-g",
    action: "agenda_convidado_descadastro",
    resource_type: "agenda_convidado",
    resource_id: "77",
  }]);
});

Deno.test("client-email-unsub: guest POST replay is idempotent", async () => {
  const { db } = makeFakeDb();
  const desc = makeDescadastrar();
  const handler = makeHandler({ db, tokens: { "g-token": GUEST }, descadastrar: desc.fn });
  assertEquals((await handler(req("POST", "g-token"))).status, 200);
  assertEquals((await handler(req("POST", "g-token"))).status, 200);
  assertEquals(desc.calls, [77, 77]);
});

Deno.test("client-email-unsub: guest id unknown to every table -- 200 page, no audit", async () => {
  const { db } = makeFakeDb();
  const desc = makeDescadastrar({ 77: null });
  const audit = makeAuditLog();
  const handler = makeHandler({ db, tokens: { "g-token": GUEST }, descadastrar: desc.fn, auditLog: audit.fn });
  const res = await handler(req("POST", "g-token"));
  assertEquals(res.status, 200);
  assert((await res.text()).includes("Pronto"));
  assertEquals(audit.calls.length, 0);
});

Deno.test("client-email-unsub: guest block failure is a generic 500 page", async () => {
  const { db } = makeFakeDb();
  const desc = makeDescadastrar({}, true);
  const audit = makeAuditLog();
  const handler = makeHandler({ db, tokens: { "g-token": GUEST }, descadastrar: desc.fn, auditLog: audit.fn });
  const original = console.error;
  console.error = () => {};
  try {
    const res = await handler(req("POST", "g-token"));
    const body = await res.text();
    assertEquals(res.status, 500);
    assert(!body.includes("db down"), "never leaks the error");
  } finally {
    console.error = original;
  }
  assertEquals(audit.calls.length, 0);
});

Deno.test("client-email-unsub: a guest token with id 0 is VALID", async () => {
  const { db } = makeFakeDb();
  const desc = makeDescadastrar();
  const handler = makeHandler({ db, tokens: { "g0": { tipo: "convidado", id: 0 } }, descadastrar: desc.fn });
  assertEquals((await handler(req("POST", "g0"))).status, 200);
  assertEquals(desc.calls, [0]);
});

Deno.test("client-email-unsub: client one-click POST never calls the guest block", async () => {
  const { db, updateCalls } = makeFakeDb();
  const desc = makeDescadastrar();
  const handler = makeHandler({ db, tokens: { "good-token": 42 }, descadastrar: desc.fn });
  assertEquals((await handler(req("POST", "good-token"))).status, 200);
  assertEquals(updateCalls.length, 1);
  assertEquals(desc.calls.length, 0);
});

// ─── createDescadastrarConvidado ────────────────────────────────────────────

function makeGuestDb(opts: { conta?: string | null; rpcError?: string } = {}) {
  const rpcs: Array<{ fn: string; args: unknown }> = [];
  const db: DescadastrarConvidadoDb = {
    rpc(fn, args) {
      rpcs.push({ fn, args });
      return Promise.resolve(
        opts.rpcError
          ? { data: null, error: { message: opts.rpcError } }
          : { data: opts.conta === undefined ? "conta-g" : opts.conta, error: null },
      );
    },
  };
  return { db, rpcs };
}

Deno.test("createDescadastrarConvidado: calls only agenda_convite_descadastrar and returns its conta_id", async () => {
  const g = makeGuestDb();
  assertEquals(await createDescadastrarConvidado(g.db)(77), { conta_id: "conta-g" });
  assertEquals(g.rpcs, [{ fn: "agenda_convite_descadastrar", args: { p_convidado: 77 } }]);
});

Deno.test("createDescadastrarConvidado: guest row gone, queue row present -- the RPC still blocks and its conta_id is audited", async () => {
  // The series DELETE cascaded the guest row away; the RPC resolves the address
  // from the surviving queue item and returns that workspace. No pre-lookup on
  // agenda_convidados can short-circuit the call any more.
  const g = makeGuestDb({ conta: "conta-da-fila" });
  const block = createDescadastrarConvidado(g.db);
  const audit = makeAuditLog();
  const { db } = makeFakeDb();
  const handler = makeHandler({ db, tokens: { "g-token": GUEST }, descadastrar: block, auditLog: audit.fn });
  const res = await handler(req("POST", "g-token"));
  assertEquals(res.status, 200);
  assert((await res.text()).includes("Pronto"));
  assertEquals(g.rpcs, [{ fn: "agenda_convite_descadastrar", args: { p_convidado: 77 } }]);
  assertEquals(audit.calls, [{
    conta_id: "conta-da-fila",
    action: "agenda_convidado_descadastro",
    resource_type: "agenda_convidado",
    resource_id: "77",
  }]);
});

Deno.test("createDescadastrarConvidado: an id no table knows (RPC returns null) resolves null", async () => {
  const g = makeGuestDb({ conta: null });
  assertEquals(await createDescadastrarConvidado(g.db)(77), null);
  assertEquals(g.rpcs.length, 1);
});

Deno.test("createDescadastrarConvidado: an RPC error throws", async () => {
  const g = makeGuestDb({ rpcError: "y" });
  let threw = false;
  try {
    await createDescadastrarConvidado(g.db)(77);
  } catch {
    threw = true;
  }
  assert(threw);
});
