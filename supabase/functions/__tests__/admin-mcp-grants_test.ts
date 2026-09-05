// Testes de _shared/admin-mcp-grants.ts (listAdminMcpGrants/revokeAdminMcpGrant) e do contrato
// de fonte que garante mcp-oauth-consent e platform-admin usarem essas mesmas funções em vez de
// reimplementar a query/lógica inline.
import { assert, assertEquals } from "./assert.ts";
import { listAdminMcpGrants, revokeAdminMcpGrant } from "../_shared/admin-mcp-grants.ts";
import { has, makeFakeDb } from "./mcp-admin-helpers.ts";

Deno.test("listAdminMcpGrants: mais recente primeiro e email via platform_admins", async () => {
  const { db, calls } = makeFakeDb({
    admin_mcp_oauth_grants: [
      {
        data: [
          { id: "g2", user_id: "u2", client_id: "c2", scopes: ["kb:read"], created_at: "2026-09-04T00:00:00Z", revoked_at: null },
          { id: "g1", user_id: "u1", client_id: "c1", scopes: ["banners:read", "banners:write"], created_at: "2026-09-01T00:00:00Z", revoked_at: "2026-09-02T00:00:00Z" },
        ],
        error: null,
      },
    ],
    platform_admins: [
      { data: [{ user_id: "u1", email: "u1@mesaas.com.br" }, { user_id: "u2", email: "u2@mesaas.com.br" }], error: null },
    ],
  });

  const grants = await listAdminMcpGrants(db);
  assertEquals(grants, [
    { id: "g2", user_id: "u2", email: "u2@mesaas.com.br", client_id: "c2", scopes: ["kb:read"], created_at: "2026-09-04T00:00:00Z", revoked_at: null },
    { id: "g1", user_id: "u1", email: "u1@mesaas.com.br", client_id: "c1", scopes: ["banners:read", "banners:write"], created_at: "2026-09-01T00:00:00Z", revoked_at: "2026-09-02T00:00:00Z" },
  ]);
  assert(has(calls, "admin_mcp_oauth_grants", "order", ["created_at", { ascending: false }]));
  assert(has(calls, "platform_admins", "in", ["user_id", ["u2", "u1"]]));
});

Deno.test("listAdminMcpGrants: sem grants -> lista vazia, sem consultar platform_admins", async () => {
  const { db, calls } = makeFakeDb({
    admin_mcp_oauth_grants: [{ data: [], error: null }],
  });
  const grants = await listAdminMcpGrants(db);
  assertEquals(grants, []);
  assert(!calls.some((c) => c.table === "platform_admins"));
});

Deno.test("listAdminMcpGrants: email null quando o user_id não tem linha em platform_admins", async () => {
  const { db } = makeFakeDb({
    admin_mcp_oauth_grants: [
      { data: [{ id: "g1", user_id: "u1", client_id: "c1", scopes: ["kb:read"], created_at: "2026-09-01T00:00:00Z", revoked_at: null }], error: null },
    ],
    platform_admins: [{ data: [], error: null }],
  });
  const grants = await listAdminMcpGrants(db);
  assertEquals(grants[0].email, null);
});

Deno.test("revokeAdminMcpGrant: atualiza a linha certa com .is(revoked_at, null) e grava audit", async () => {
  const { db, calls } = makeFakeDb({
    admin_mcp_oauth_grants: [{ data: { id: "g1", client_id: "c1", user_id: "u1" }, error: null }],
  });
  const result = await revokeAdminMcpGrant(db, "g1", "actor-1");
  assertEquals(result, { ok: true });
  assert(has(calls, "admin_mcp_oauth_grants", "eq", ["id", "g1"]));
  assert(has(calls, "admin_mcp_oauth_grants", "is", ["revoked_at", null]));
  const updateCall = calls.find((c) => c.table === "admin_mcp_oauth_grants" && c.method === "update");
  assert(!!updateCall, "expected an update() call on admin_mcp_oauth_grants");
  const patch = updateCall!.args[0] as { revoked_at: string; revoked_by: string };
  assertEquals(patch.revoked_by, "actor-1");
  assert(typeof patch.revoked_at === "string" && patch.revoked_at.length > 0);

  const auditInsert = calls.find((c) => c.table === "audit_log" && c.method === "insert");
  assert(!!auditInsert, "expected an audit_log insert");
  const entry = auditInsert!.args[0] as Record<string, unknown>;
  assertEquals(entry.actor_user_id, "actor-1");
  assertEquals(entry.action, "mcp_admin.oauth.revoke");
  assertEquals(entry.resource_type, "admin_mcp_oauth_grant");
  assertEquals(entry.resource_id, "c1");
  assertEquals((entry.metadata as { grant_user_id: string }).grant_user_id, "u1");
});

Deno.test("revokeAdminMcpGrant: id inexistente ou já revogado -> not_found, sem audit", async () => {
  const { db, calls } = makeFakeDb({
    admin_mcp_oauth_grants: [{ data: null, error: null }],
  });
  const result = await revokeAdminMcpGrant(db, "missing", "actor-1");
  assertEquals(result, { ok: false, reason: "not_found" });
  assert(!calls.some((c) => c.table === "audit_log" && c.method === "insert"), "must not audit a no-op revoke");
});

// --- Contrato de fonte: mcp-oauth-consent e platform-admin chamam as funções compartilhadas ---

Deno.test("mcp-oauth-consent: list-admin-grants/revoke-admin-grant delegam para _shared/admin-mcp-grants.ts", async () => {
  const src = await Deno.readTextFile(new URL("../mcp-oauth-consent/index.ts", import.meta.url));
  assert(
    /import \{ listAdminMcpGrants, revokeAdminMcpGrant \} from ["']\.\.\/_shared\/admin-mcp-grants\.ts["']/.test(src),
    "expected the shared import",
  );
  const blockStart = src.indexOf('if (action === "list-admin-grants"');
  const blockEnd = src.indexOf('return json({ error: "unknown action" }, 400);');
  assert(blockStart >= 0 && blockEnd > blockStart, "expected the list-admin-grants/revoke-admin-grant block");
  const block = src.slice(blockStart, blockEnd);
  assert(/isPlatformAdmin\(svc, user\.id\)/.test(block), "gate must still run before the shared calls");
  assert(/await listAdminMcpGrants\(svc\)/.test(block), "list-admin-grants must call the shared lister");
  assert(/await revokeAdminMcpGrant\(svc, grantId, user\.id\)/.test(block), "revoke-admin-grant must call the shared revoker");
  assert(!/\.from\("admin_mcp_oauth_grants"\)/.test(block), "the inline query must be gone -- only the shared functions touch the table now");
});

Deno.test("platform-admin: list-admin-mcp-grants/revoke-admin-mcp-grant existem no switch e chamam as funções compartilhadas", async () => {
  const src = await Deno.readTextFile(new URL("../platform-admin/index.ts", import.meta.url));
  assert(
    /import \{ listAdminMcpGrants, revokeAdminMcpGrant \} from ["']\.\.\/_shared\/admin-mcp-grants\.ts["']/.test(src),
    "expected the shared import",
  );
  assert(
    /case ["']list-admin-mcp-grants["']:\s*\n\s*return await handleListAdminMcpGrants\(svc, headers\);/.test(src),
    "expected the list-admin-mcp-grants case in the switch",
  );
  assert(
    /case ["']revoke-admin-mcp-grant["']:\s*\n\s*return await handleRevokeAdminMcpGrant\(svc, body, user\.id, headers\);/.test(src),
    "expected the revoke-admin-mcp-grant case in the switch",
  );

  const start = src.indexOf("async function handleListAdminMcpGrants");
  assert(start >= 0, "handleListAdminMcpGrants not found");
  const rest = src.slice(start);
  const listFn = rest.slice(0, rest.indexOf("async function handleRevokeAdminMcpGrant"));
  assert(/await listAdminMcpGrants\(svc\)/.test(listFn), "handleListAdminMcpGrants must call the shared lister");

  const revokeStart = src.indexOf("async function handleRevokeAdminMcpGrant");
  const revokeRest = src.slice(revokeStart);
  const nextFnOffset = revokeRest.indexOf("\nasync function", 1);
  const revokeFn = revokeRest.slice(0, nextFnOffset >= 0 ? nextFnOffset : undefined);
  assert(/await revokeAdminMcpGrant\(svc, grantId, actorUserId\)/.test(revokeFn), "handleRevokeAdminMcpGrant must call the shared revoker");
  assert(/status: 404/.test(revokeFn) && /Grant not found/.test(revokeFn), "expected a 404 'Grant not found' on not_found");
});
