import { assert, assertEquals } from "./assert.ts";
import {
  assertClientAccess,
  ClientScopeError,
  type ClientScope,
  hasClientAccess,
  isOwnItem,
  loadClientScope,
  rowVisibility,
  rowWriteGate,
  allClientsScope,
  visibleClientIds,
} from "../_shared/client-scope.ts";

type Resp = { data: unknown; error: unknown };
type Call = { table: string; method: string; args: unknown[] };

function fakeDb(responses: Record<string, Resp>) {
  const calls: Call[] = [];
  const db = {
    from(table: string) {
      calls.push({ table, method: "from", args: [] });
      // deno-lint-ignore no-explicit-any
      const rec: any = {};
      for (const m of ["select", "eq"]) {
        rec[m] = (...args: unknown[]) => {
          calls.push({ table, method: m, args });
          return rec;
        };
      }
      const resp = () => responses[table] ?? { data: null, error: null };
      rec.maybeSingle = () => Promise.resolve(resp());
      rec.then = (resolve: (r: Resp) => unknown) => Promise.resolve(resolve(resp()));
      return rec;
    },
  };
  return { db, calls };
}

const tables = (calls: Call[]) => [...new Set(calls.filter((c) => c.method === "from").map((c) => c.table))];

Deno.test("loadClientScope: owner sees all, without reading assignments", async () => {
  const { db, calls } = fakeDb({ workspace_members: { data: { role: "owner", client_scope: "atribuidos" }, error: null } });
  const s = await loadClientScope(db, "u1", "w1");
  assertEquals(s.all, true);
  assertEquals(tables(calls), ["workspace_members"]);
  assert(calls.some((c) => c.method === "eq" && JSON.stringify(c.args) === '["user_id","u1"]'));
  assert(calls.some((c) => c.method === "eq" && JSON.stringify(c.args) === '["workspace_id","w1"]'));
});

Deno.test("loadClientScope: 'todos' sees all, no further reads", async () => {
  const { db, calls } = fakeDb({ workspace_members: { data: { role: "agent", client_scope: "todos" }, error: null } });
  const s = await loadClientScope(db, "u1", "w1");
  assertEquals(s.all, true);
  assertEquals(tables(calls), ["workspace_members"]);
});

Deno.test("loadClientScope: 'atribuidos' loads assigned ids and the user's membros ids", async () => {
  const { db, calls } = fakeDb({
    workspace_members: { data: { role: "agent", client_scope: "atribuidos" }, error: null },
    workspace_member_clientes: { data: [{ cliente_id: 5 }, { cliente_id: 7 }], error: null },
    membros: { data: [{ id: 30 }], error: null },
  });
  const s = await loadClientScope(db, "u1", "w1");
  assertEquals(s.all, false);
  assertEquals([...s.ids].sort(), [5, 7]);
  assertEquals([...s.membroIds], [30]);
  assert(calls.some((c) => c.table === "workspace_member_clientes" && c.method === "eq" && JSON.stringify(c.args) === '["user_id","u1"]'));
  assert(calls.some((c) => c.table === "membros" && c.method === "eq" && JSON.stringify(c.args) === '["crm_user_id","u1"]'));
  assert(calls.some((c) => c.table === "membros" && c.method === "eq" && JSON.stringify(c.args) === '["conta_id","w1"]'));
});

Deno.test("loadClientScope: 'atribuidos' with zero rows is zero clients, never all", async () => {
  const { db } = fakeDb({
    workspace_members: { data: { role: "admin", client_scope: "atribuidos" }, error: null },
    workspace_member_clientes: { data: [], error: null },
    membros: { data: null, error: null },
  });
  const s = await loadClientScope(db, "u1", "w1");
  assertEquals(s.all, false);
  assertEquals(s.ids.size, 0);
  assertEquals(visibleClientIds(s), []);
});

Deno.test("loadClientScope: no membership row -> no clients", async () => {
  const { db } = fakeDb({ workspace_members: { data: null, error: null } });
  const s = await loadClientScope(db, "u1", "w1");
  assertEquals(s.all, false);
  assertEquals(s.ids.size, 0);
});

Deno.test("loadClientScope: unknown client_scope throws", async () => {
  for (const v of ["algum", null, undefined]) {
    const { db } = fakeDb({ workspace_members: { data: { role: "agent", client_scope: v }, error: null } });
    let threw = false;
    try {
      await loadClientScope(db, "u1", "w1");
    } catch {
      threw = true;
    }
    assert(threw, `client_scope=${String(v)} must throw`);
  }
});

Deno.test("loadClientScope: any read error throws (never all)", async () => {
  const cases: Record<string, Resp>[] = [
    { workspace_members: { data: null, error: { message: "boom" } } },
    {
      workspace_members: { data: { role: "agent", client_scope: "atribuidos" }, error: null },
      workspace_member_clientes: { data: null, error: { message: "boom" } },
    },
    {
      workspace_members: { data: { role: "agent", client_scope: "atribuidos" }, error: null },
      workspace_member_clientes: { data: [{ cliente_id: 1 }], error: null },
      membros: { data: null, error: { message: "boom" } },
    },
  ];
  for (const responses of cases) {
    const { db } = fakeDb(responses);
    let threw = false;
    try {
      await loadClientScope(db, "u1", "w1");
    } catch {
      threw = true;
    }
    assert(threw);
  }
});

const RESTRICTED: ClientScope = { all: false, ids: new Set([5]), membroIds: new Set([30]) };
const ALL: ClientScope = { all: true, ids: new Set(), membroIds: new Set() };

function throwsScope(fn: () => void): boolean {
  try {
    fn();
    return false;
  } catch (e) {
    return e instanceof ClientScopeError;
  }
}

Deno.test("assertClientAccess: all, assigned and own pass; hidden and null throw", () => {
  assertClientAccess(ALL, 99, false);
  assertClientAccess(ALL, null, false);
  assertClientAccess(RESTRICTED, 5, false);
  assertClientAccess(RESTRICTED, 99, true);
  assertClientAccess(RESTRICTED, null, true);
  assert(throwsScope(() => assertClientAccess(RESTRICTED, 99, false)));
  assert(throwsScope(() => assertClientAccess(RESTRICTED, null, false)));
  assert(throwsScope(() => assertClientAccess({ all: false, ids: new Set(), membroIds: new Set() }, 5, false)));
  assertEquals(hasClientAccess(RESTRICTED, 99, false), false);
  assertEquals(new ClientScopeError().code, "client_scope_restricted");
});

Deno.test("isOwnItem: responsavel_id in membroIds or author uuid", () => {
  assertEquals(isOwnItem(RESTRICTED, { responsavelId: 30 }, "u1"), true);
  assertEquals(isOwnItem(RESTRICTED, { responsavelId: 31 }, "u1"), false);
  assertEquals(isOwnItem(RESTRICTED, { responsavelId: null, createdBy: "u1" }, "u1"), true);
  assertEquals(isOwnItem(RESTRICTED, { createdBy: "u2" }, "u1"), false);
  assertEquals(visibleClientIds(ALL), null);
});

Deno.test("rowVisibility: visible / own_only / hidden", () => {
  const scope: ClientScope = { all: false, ids: new Set([5]), membroIds: new Set([30]) };
  assertEquals(rowVisibility(scope, { cliente_id: 5, responsavel_id: null }, "u1"), "visible");
  assertEquals(rowVisibility(scope, { cliente_id: 9, responsavel_id: 30 }, "u1"), "own_only");
  assertEquals(rowVisibility(scope, { cliente_id: 9, created_by: "u1" }, "u1"), "own_only");
  assertEquals(rowVisibility(scope, { cliente_id: 9, responsavel_id: 31 }, "u1"), "hidden");
  assertEquals(rowVisibility(scope, { cliente_id: null }, "u1"), "hidden");
  assertEquals(rowVisibility(allClientsScope(), { cliente_id: 9 }, "u1"), "visible");
});

Deno.test("rowWriteGate: allowed / not found / limitado / scope error", async () => {
  const nf = { status: 404, body: { error: "Post not found" } };
  const scope = (s: ClientScope) => () => Promise.resolve(s);
  const r = { all: false, ids: new Set([5]), membroIds: new Set([30]) };
  const db = { from: () => { throw new Error("no reads expected"); } };
  assertEquals(await rowWriteGate(db, "u1", "w1", { cliente_id: 5 }, nf, scope(r)), null);
  assertEquals(await rowWriteGate(db, "u1", "w1", { cliente_id: 9, responsavel_id: 31 }, nf, scope(r)), nf);
  assertEquals(await rowWriteGate(db, "u1", "w1", { cliente_id: 9, responsavel_id: 30 }, nf, scope(r)), {
    status: 403,
    body: { error: "Seu acesso é limitado aos clientes atribuídos." },
  });
  assertEquals(await rowWriteGate(db, "u1", "w1", { cliente_id: 9 }, nf, scope(allClientsScope())), null);
  const failed = await rowWriteGate(db, "u1", "w1", { cliente_id: 5 }, nf, () => Promise.reject(new Error("x")));
  assertEquals(failed?.status, 500);
});
