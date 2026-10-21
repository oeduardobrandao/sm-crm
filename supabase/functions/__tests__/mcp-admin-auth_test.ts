import { assert, assertEquals } from "./assert.ts";
import {
  ADMIN_MCP_ALLOWED_SCOPES,
  ADMIN_MCP_READ_PRESET,
  adminScopesFromClaim,
  validateAdminScopes,
} from "../_shared/mcp-admin-scopes.ts";
import {
  adminGrantActive,
  requireAdminScope,
  resolveAdminCtx,
  type AdminMcpContext,
} from "../_shared/mcp-admin-auth.ts";
import { McpScopeError } from "../_shared/mcp-token.ts";

function b64url(o: unknown): string {
  return btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function makeJwt(payload: Record<string, unknown>): string {
  return `${b64url({ alg: "HS256", typ: "JWT" })}.${b64url(payload)}.sig`;
}

type Resp = { data: unknown; error: unknown };

/** Fake mínimo: auth.getUser fixo + from(table) devolvendo a próxima resposta enfileirada. */
function makeFakeDb(userId: string | null, responses: Record<string, Resp[]>) {
  const queues: Record<string, Resp[]> = {};
  for (const k of Object.keys(responses)) queues[k] = [...responses[k]];
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  function recorder(table: string) {
    // deno-lint-ignore no-explicit-any
    const rec: any = {};
    const next = (): Resp => (queues[table] ?? []).shift() ?? { data: null, error: null };
    for (const m of ["select", "eq", "is", "order", "limit"]) {
      rec[m] = (...args: unknown[]) => { calls.push({ table, method: m, args }); return rec; };
    }
    rec.maybeSingle = () => Promise.resolve(next());
    rec.single = () => Promise.resolve(next());
    return rec;
  }
  const db = {
    auth: {
      getUser: (_t: string) =>
        Promise.resolve(userId ? { data: { user: { id: userId } }, error: null } : { data: { user: null }, error: { message: "bad" } }),
    },
    from: (t: string) => recorder(t),
  };
  return { db, calls };
}

Deno.test("validateAdminScopes: aceita subconjunto não vazio da allowlist e rejeita o resto", () => {
  assert(validateAdminScopes(["kb:read", "platform:read"]));
  assertEquals(validateAdminScopes([]), false);
  assertEquals(validateAdminScopes(["posts:read"]), false); // escopo do mcp de workspace
  assertEquals(validateAdminScopes("kb:read"), false);
  assertEquals(ADMIN_MCP_ALLOWED_SCOPES.length, 7);
});

Deno.test("adminScopesFromClaim: filtra pela allowlist do admin", () => {
  assertEquals(adminScopesFromClaim("openid kb:read posts:read banners:write"), ["kb:read", "banners:write"]);
  assertEquals(adminScopesFromClaim(["popups:read", 3, "x"]), ["popups:read"]);
  assertEquals(adminScopesFromClaim(null), []);
});

Deno.test("adminGrantActive: exige grant não revogado E admin atual", () => {
  assertEquals(adminGrantActive({ revoked_at: null }, true), true);
  assertEquals(adminGrantActive({ revoked_at: null }, false), false);
  assertEquals(adminGrantActive({ revoked_at: "2026-01-01T00:00:00Z" }, true), false);
  assertEquals(adminGrantActive(null, true), false);
});

Deno.test("resolveAdminCtx: token inválido → null", async () => {
  const { db } = makeFakeDb(null, {});
  // deno-lint-ignore no-explicit-any
  assertEquals(await resolveAdminCtx(db as any, makeJwt({ client_id: "c1" })), null);
});

Deno.test("resolveAdminCtx: usuário sem linha em platform_admins → null (mesmo com grant)", async () => {
  const { db } = makeFakeDb("u1", {
    platform_admins: [{ data: null, error: null }],
    admin_mcp_oauth_grants: [{ data: { scopes: ["kb:read"], revoked_at: null }, error: null }],
  });
  // deno-lint-ignore no-explicit-any
  assertEquals(await resolveAdminCtx(db as any, makeJwt({ client_id: "c1" })), null);
});

Deno.test("resolveAdminCtx: grant revogado → null", async () => {
  const { db } = makeFakeDb("u1", {
    platform_admins: [{ data: { id: "adm-1" }, error: null }],
    admin_mcp_oauth_grants: [{ data: { scopes: ["kb:read"], revoked_at: "2026-01-01T00:00:00Z" }, error: null }],
  });
  // deno-lint-ignore no-explicit-any
  assertEquals(await resolveAdminCtx(db as any, makeJwt({ client_id: "c1" })), null);
});

Deno.test("resolveAdminCtx: sem client_id no token → null", async () => {
  const { db } = makeFakeDb("u1", { platform_admins: [{ data: { id: "adm-1" }, error: null }] });
  // deno-lint-ignore no-explicit-any
  assertEquals(await resolveAdminCtx(db as any, makeJwt({ sub: "u1" })), null);
});

Deno.test("resolveAdminCtx: admin + grant ativo → ctx com scopes do grant e key_id oauth:<client>", async () => {
  const { db, calls } = makeFakeDb("u1", {
    platform_admins: [{ data: { id: "adm-1" }, error: null }],
    admin_mcp_oauth_grants: [{ data: { scopes: ["kb:read", "banners:write"], revoked_at: null }, error: null }],
  });
  // deno-lint-ignore no-explicit-any
  const ctx = await resolveAdminCtx(db as any, makeJwt({ azp: "c1" }));
  assertEquals(ctx, { admin_id: "adm-1", user_id: "u1", scopes: ["kb:read", "banners:write"], key_id: "oauth:c1" });
  // grant consultado por (user_id, client_id)
  assert(calls.some((c) => c.table === "admin_mcp_oauth_grants" && c.method === "eq" && JSON.stringify(c.args) === JSON.stringify(["client_id", "c1"])));
});

Deno.test("resolveAdminCtx: token com scopes MCP do admin limita o grant (interseção)", async () => {
  const { db } = makeFakeDb("u1", {
    platform_admins: [{ data: { id: "adm-1" }, error: null }],
    admin_mcp_oauth_grants: [{ data: { scopes: ["kb:read", "kb:write"], revoked_at: null }, error: null }],
  });
  // deno-lint-ignore no-explicit-any
  const ctx = await resolveAdminCtx(db as any, makeJwt({ client_id: "c1", scope: "openid kb:read" }));
  assertEquals(ctx?.scopes, ["kb:read"]);
});

// Guarda de sincronia (revisão externa): apps/crm/src/lib/mcp-scopes.ts documenta um espelho
// manual de ADMIN_MCP_ALLOWED_SCOPES/ADMIN_MCP_READ_PRESET (comentário na linha 28-29 do
// arquivo CRM) mas nada verificava que o espelho estava correto -- um escopo adicionado só do
// lado Deno ficaria invisível na UI de consentimento sem nenhum teste quebrar.
Deno.test("ADMIN_SCOPE_OPTIONS/ADMIN_READ_PRESET do CRM espelham _shared/mcp-admin-scopes.ts", async () => {
  const src = await Deno.readTextFile(new URL("../../../apps/crm/src/lib/mcp-scopes.ts", import.meta.url));

  const optionsStart = src.indexOf("export const ADMIN_SCOPE_OPTIONS");
  assert(optionsStart >= 0, "ADMIN_SCOPE_OPTIONS not found in apps/crm/src/lib/mcp-scopes.ts");
  const optionsEnd = src.indexOf("] as const;", optionsStart);
  const optionsBlock = src.slice(optionsStart, optionsEnd);
  const optionValues = [...optionsBlock.matchAll(/value:\s*'([^']+)'/g)].map((m) => m[1]);

  const presetStart = src.indexOf("export const ADMIN_READ_PRESET");
  assert(presetStart >= 0, "ADMIN_READ_PRESET not found in apps/crm/src/lib/mcp-scopes.ts");
  const presetEnd = src.indexOf("];", presetStart);
  const presetBlock = src.slice(presetStart, presetEnd);
  const presetValues = [...presetBlock.matchAll(/'([^']+)'/g)].map((m) => m[1]);

  assertEquals(optionValues, [...ADMIN_MCP_ALLOWED_SCOPES]);
  assertEquals(presetValues, ADMIN_MCP_READ_PRESET);
});

// Mesma classe de bug, segundo espelho: apps/admin/src/lib/mcp-admin-scopes.ts documenta uma
// cópia manual de ADMIN_MCP_ALLOWED_SCOPES para a página Integrations do Admin (comentário no
// topo do arquivo confirma que não tinha guarda de sincronia).
Deno.test("ADMIN_SCOPES do app Admin espelha _shared/mcp-admin-scopes.ts", async () => {
  const src = await Deno.readTextFile(new URL("../../../apps/admin/src/lib/mcp-admin-scopes.ts", import.meta.url));

  const optionsStart = src.indexOf("export const ADMIN_SCOPES");
  assert(optionsStart >= 0, "ADMIN_SCOPES not found in apps/admin/src/lib/mcp-admin-scopes.ts");
  const optionsEnd = src.indexOf("] as const;", optionsStart);
  const optionsBlock = src.slice(optionsStart, optionsEnd);
  const optionValues = [...optionsBlock.matchAll(/value:\s*'([^']+)'/g)].map((m) => m[1]);

  assertEquals(optionValues, [...ADMIN_MCP_ALLOWED_SCOPES]);
});

Deno.test("requireAdminScope: lança McpScopeError com o escopo faltante", () => {
  const ctx: AdminMcpContext = { admin_id: "a", user_id: "u", scopes: ["kb:read"], key_id: "oauth:c" };
  requireAdminScope(ctx, "kb:read");
  let caught: unknown;
  try { requireAdminScope(ctx, "kb:write"); } catch (e) { caught = e; }
  assert(caught instanceof McpScopeError);
  assertEquals((caught as McpScopeError).scope, "kb:write");
});
