import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { hasPermissionFor } from "../_shared/permissions.ts";
import { ownerOnlyScopeViolation } from "../_shared/mcp-token.ts";
import { permittedMcpScopes } from "../_shared/mcp-oauth.ts";

// mcp-oauth-consent/index.ts wraps its handler in Deno.serve, which no test in
// this suite invokes directly (it would bind a real network listener). This
// file pairs a source-contract check (confirms index.ts actually wires each
// of the three gates this way) with a mirror of each gate's decision logic,
// exercised against the REAL hasPermissionFor + a stubbed service client.
//
// Task 11: all three gates move from a role literal (`isManager` /
// `.in("role", ["owner","admin"])`) to has_permission_for(...,
// 'configuracoes', 'editar') --
//   - eligible-workspaces: filters ALL memberships by the permission (was:
//     `.in("role", ["owner","admin"])` at the query level).
//   - approve: authorizes against the CHOSEN workspace from the payload (was:
//     isManager(membership.role) for that workspace).
//   - list-grants / revoke-grant: authorizes against the ACTIVE workspace
//     (profile.active_workspace_id, not the stale global profile.conta_id).
//
// Revisão externa (P2): that last gate demanded 'editar' for BOTH actions,
// so a papel with `configuracoes:ver` opening the read-only MCP tab got a 403
// and an empty connections list. 'list-grants' now requires only 'ver';
// 'revoke-grant' keeps 'editar'. eligible-workspaces and approve are
// unchanged -- both are consent-GRANTING steps, i.e. mutations.
//
// Agents connecting Claude: eligible-workspaces and approve no longer require
// 'configuracoes' at all. The MCP tools run service-role and only check the
// grant's scopes, so the grant is instead capped by the user's OWN role
// (permittedMcpScopes / MCP_SCOPE_PERMISSION), at consent and again on every
// MCP request. list-grants/revoke-grant open to every member for their OWN
// connections; 'configuracoes' (ver to list, editar to revoke) still covers
// everyone else's.

function assertMatch(value: string, pattern: RegExp, msg?: string) {
  assert(pattern.test(value), msg ?? `Expected source to match ${pattern}`);
}

const source = await Deno.readTextFile(
  new URL("../mcp-oauth-consent/index.ts", import.meta.url),
);

Deno.test("mcp-oauth-consent: connecting no longer requires configuracoes; scopes are capped by the role", () => {
  assertMatch(source, /import \{ hasPermissionFor \} from ["']\.\.\/_shared\/permissions\.ts["']/);
  assert(!/function isManager/.test(source), "the role-literal isManager helper must be removed");
  assert(!/\.in\(["']role["'],\s*\[["']owner["'],\s*["']admin["']\]\)/.test(source), "eligible-workspaces must not pre-filter by role at the query level");
  assert(
    !/hasPermissionFor\(svc,\s*user\.id,\s*[^,]+,\s*["']configuracoes["'],\s*["']editar["']\)/.test(source),
    "neither eligible-workspaces nor approve may gate on configuracoes:editar any more",
  );
  assertMatch(source, /const allowed_scopes = \(await permittedMcpScopes\(svc, user\.id, m\.workspace_id as string\)\)\s*\.filter\(\(s\) => !ownerOnlyScopeViolation\(\[s\], m\.role as string\)\)/);
  assertMatch(source, /const permitted = await permittedMcpScopes\(svc, user\.id, contaId, scopes\);\s*if \(permitted\.length !== scopes\.length\)/);
});

Deno.test("mcp-oauth-consent: the grants gate splits list-grants ('ver') from revoke-grant ('editar'), else own-only", () => {
  assertMatch(source, /const requiredAction = action === ["']list-grants["'] \? ["']ver["'] : ["']editar["']/);
  assertMatch(
    source,
    /hasPermissionFor\(svc,\s*user\.id,\s*contaId,\s*["']configuracoes["'],\s*requiredAction\)/,
  );
  assertMatch(source, /if \(!canManage\) query = query\.eq\("user_id", user\.id\);/);
  assertMatch(source, /if \(!canManage\) revoke = revoke\.eq\("user_id", user\.id\);/);
  assertMatch(source, /mine: g\.user_id === user\.id/);
});

Deno.test("mcp-oauth-consent: list-grants/revoke-grant scope from profile.active_workspace_id, not profile.conta_id", () => {
  const block = source.match(/if \(action === ["']list-grants["'][\s\S]*?const contaId[\s\S]*?\n\s*\}/)?.[0] ?? "";
  assert(block.length > 0, "expected the list-grants/revoke-grant block");
  assertMatch(block, /\.select\(["']active_workspace_id["']\)/);
  assert(!/\.select\(["']role, conta_id["']\)/.test(block), "must not read the stale global profile.conta_id/role");
});

/** Stub service client whose has_permission_for answers per workspace from "module:action" sets. */
function permSvc(byWorkspace: Record<string, string[]>) {
  return {
    rpc: (_name: string, p: Record<string, unknown>) =>
      Promise.resolve({
        data: (byWorkspace[p.p_workspace as string] ?? []).includes(`${p.p_module}:${p.p_action}`),
        error: null,
      }),
  };
}
const AGENT_PRESET_PERMS = [
  "clientes:ver", "clientes:editar", "entregas:ver", "entregas:editar",
  "ideias:ver", "ideias:editar", "tarefas:ver", "tarefas:editar",
];

// --- eligible-workspaces: every membership whose role allows some scope ---

async function eligibleWorkspaces(
  // deno-lint-ignore no-explicit-any
  svc: any,
  userId: string,
  memberships: Array<{ workspace_id: string }>,
): Promise<Array<{ id: string; allowed_scopes: string[] }>> {
  const eligible = [];
  for (const m of memberships) {
    const allowed_scopes = await permittedMcpScopes(svc, userId, m.workspace_id);
    if (allowed_scopes.length === 0) continue;
    eligible.push({ id: m.workspace_id, allowed_scopes });
  }
  return eligible;
}

Deno.test("eligible-workspaces: an agent without configuracoes is listed, with only their role's scopes", async () => {
  const svc = permSvc({ "ws-a": AGENT_PRESET_PERMS, "ws-b": [] });
  const result = await eligibleWorkspaces(svc, "u1", [{ workspace_id: "ws-a" }, { workspace_id: "ws-b" }]);
  assertEquals(result.map((w) => w.id), ["ws-a"], "a role with no MCP-relevant permission is skipped");
  assert(!result[0].allowed_scopes.some((s) => s.startsWith("membros:")), "equipe none -> no membros scope");
  assert(result[0].allowed_scopes.includes("posts:write"));
});

// --- approve: every approved scope must be allowed by the role in the CHOSEN workspace ---

async function approveGate(
  // deno-lint-ignore no-explicit-any
  svc: any,
  userId: string,
  contaId: string,
  scopes: string[],
): Promise<{ status: number }> {
  const permitted = await permittedMcpScopes(svc, userId, contaId, scopes);
  if (permitted.length !== scopes.length) return { status: 403 };
  return { status: 200 };
}

Deno.test("approve: agent with read scopes their role allows -> allowed", async () => {
  const svc = permSvc({ "ws-a": AGENT_PRESET_PERMS });
  assertEquals((await approveGate(svc, "u1", "ws-a", ["clientes:read", "posts:read", "posts:write"])).status, 200);
});

Deno.test("approve: agent asking for membros:write (equipe none) -> refused", async () => {
  const svc = permSvc({ "ws-a": AGENT_PRESET_PERMS });
  assertEquals((await approveGate(svc, "u1", "ws-a", ["posts:read", "membros:write"])).status, 403);
});

Deno.test("approve: permissions are read from the CHOSEN workspace, not another membership", async () => {
  const svc = permSvc({ "ws-a": [], "ws-b": AGENT_PRESET_PERMS });
  assertEquals((await approveGate(svc, "u1", "ws-a", ["posts:read"])).status, 403);
  assertEquals((await approveGate(svc, "u1", "ws-b", ["posts:read"])).status, 200);
});

Deno.test("approve: a non-member of the chosen workspace is refused (has_permission_for fails closed)", async () => {
  const svc = createSupabaseQueryMock();
  svc.queueRpc("has_permission_for", { data: false, error: null });
  assertEquals((await approveGate(svc, "u1", "ws-a", ["posts:read"])).status, 403);
});

// --- list-grants / revoke-grant: gate against the ACTIVE workspace ---

async function grantsGate(
  // deno-lint-ignore no-explicit-any
  svc: any,
  userId: string,
  profile: { active_workspace_id: string | null } | null,
  action = "revoke-grant",
): Promise<{ status: number; contaId?: string; ownOnly?: boolean }> {
  const contaId = profile?.active_workspace_id as string | undefined;
  if (!contaId) return { status: 403 };
  const requiredAction = action === "list-grants" ? "ver" : "editar";
  const canManage = await hasPermissionFor(svc, userId, contaId, "configuracoes", requiredAction);
  return { status: 200, contaId, ownOnly: !canManage };
}

Deno.test("list/revoke-grant: owner/admin of the active workspace covers every connection", async () => {
  const svc = createSupabaseQueryMock();
  svc.queueRpc("has_permission_for", { data: true, error: null });
  assertEquals(await grantsGate(svc, "u1", { active_workspace_id: "ws-a" }), { status: 200, contaId: "ws-a", ownOnly: false });
});

Deno.test("list/revoke-grant: an agent without configuracoes is limited to their own connections", async () => {
  const svc = createSupabaseQueryMock();
  svc.queueRpc("has_permission_for", { data: false, error: null });
  assertEquals(await grantsGate(svc, "u1", { active_workspace_id: "ws-a" }), { status: 200, contaId: "ws-a", ownOnly: true });
});

Deno.test("list/revoke-grant: no active workspace -> 403, no RPC call", async () => {
  const svc = createSupabaseQueryMock();
  assertEquals((await grantsGate(svc, "u1", { active_workspace_id: null })).status, 403);
  assertEquals((await grantsGate(svc, "u1", null)).status, 403);
  assertEquals(svc.calls.length, 0);
});

/**
 * Revisão externa (P2): the read/write split on the grants block. Asserting
 * the p_action actually sent -- a ver-only role sees every connection but can
 * only revoke its own.
 */
Deno.test("list-grants: a ver-only role sees every connection and asks for p_action 'ver'", async () => {
  const svc = createSupabaseQueryMock();
  svc.queueRpc("has_permission_for", { data: true, error: null });
  assertEquals((await grantsGate(svc, "u1", { active_workspace_id: "ws-a" }, "list-grants")).ownOnly, false);
  const call = svc.calls.find((c: { table: string }) => c.table === "rpc:has_permission_for");
  assertEquals(call?.payload, { p_user: "u1", p_workspace: "ws-a", p_module: "configuracoes", p_action: "ver" });
});

Deno.test("revoke-grant: a ver-only role is limited to its own, and the gate asks for 'editar'", async () => {
  const svc = createSupabaseQueryMock();
  svc.queueRpc("has_permission_for", { data: false, error: null });
  assertEquals((await grantsGate(svc, "u1", { active_workspace_id: "ws-a" }, "revoke-grant")).ownOnly, true);
  const call = svc.calls.find((c: { table: string }) => c.table === "rpc:has_permission_for");
  assertEquals((call?.payload as { p_action: string }).p_action, "editar");
});

Deno.test("mcp-oauth-consent: target platform exige platform_admins e grava em admin_mcp_oauth_grants", async () => {
  const src = await Deno.readTextFile(new URL("../mcp-oauth-consent/index.ts", import.meta.url));
  assertMatch(src, /platform_admin: await isPlatformAdmin\(svc, user\.id\)/, "eligible-workspaces deve anotar platform_admin");
  assertMatch(src, /target === "platform"[\s\S]*?isPlatformAdmin\(svc, user\.id\)[\s\S]*?from\("admin_mcp_oauth_grants"\)[\s\S]*?upsert\(/, "approve platform: gate + upsert na tabela do admin");
  assertMatch(src, /action === "list-admin-grants" \|\| action === "revoke-admin-grant"[\s\S]*?isPlatformAdmin\(svc, user\.id\)/, "list/revoke admin grants gated por platform_admins");
  assert(!/admin_mcp_oauth_grants"\)[\s\S]{0,400}assertPlanFeature/.test(src), "grants do admin não passam por feature_mcp");
});

// --- financeiro:* scopes: owner-only grants (Task 7) ---

Deno.test("mcp-oauth-consent approve: owner check on the CHOSEN conta_id, before the grant upsert", () => {
  assertMatch(source, /ownerOnlyScopeViolation/);
  assertMatch(source, /memberRole/);
  assertMatch(
    source,
    /ownerOnlyScopeViolation\(grantScopes,\s*await memberRole\(svc,\s*user\.id,\s*contaId\)\)/,
  );
  assertMatch(source, /error:\s*["']owner_only_scope["']/);
  const violationIdx = source.indexOf("ownerOnlyScopeViolation(grantScopes");
  const boundIdx = source.indexOf("boundGrantScopes(scopes, requestedMcp)");
  const upsertIdx = source.indexOf('.from("mcp_oauth_grants")');
  assert(boundIdx > -1 && violationIdx > boundIdx, "owner check runs on the bounded grant scopes");
  assert(upsertIdx > violationIdx, "owner check runs before the mcp_oauth_grants upsert");
});

Deno.test("mcp-oauth-consent approve: owner gate decision for the chosen workspace", () => {
  assertEquals(ownerOnlyScopeViolation(["posts:read", "financeiro:read"], "admin"), true);
  assertEquals(ownerOnlyScopeViolation(["financeiro:write"], "agent"), true);
  assertEquals(ownerOnlyScopeViolation(["financeiro:write"], null), true);
  assertEquals(ownerOnlyScopeViolation(["financeiro:read", "financeiro:write"], "owner"), false);
  assertEquals(ownerOnlyScopeViolation(["posts:read"], "admin"), false);
});
