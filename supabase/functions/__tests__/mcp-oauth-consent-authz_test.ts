import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { hasPermissionFor } from "../_shared/permissions.ts";

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

function assertMatch(value: string, pattern: RegExp, msg?: string) {
  assert(pattern.test(value), msg ?? `Expected source to match ${pattern}`);
}

const source = await Deno.readTextFile(
  new URL("../mcp-oauth-consent/index.ts", import.meta.url),
);

Deno.test("mcp-oauth-consent: isManager is gone; the two mutation gates hardcode 'editar'", () => {
  assertMatch(source, /import \{ hasPermissionFor \} from ["']\.\.\/_shared\/permissions\.ts["']/);
  assert(!/function isManager/.test(source), "the role-literal isManager helper must be removed");
  assert(!/\.in\(["']role["'],\s*\[["']owner["'],\s*["']admin["']\]\)/.test(source), "eligible-workspaces must not pre-filter by role at the query level");
  const gateCalls = source.match(/hasPermissionFor\(svc,\s*user\.id,\s*[^,]+,\s*["']configuracoes["'],\s*["']editar["']\)/g) ?? [];
  assertEquals(gateCalls.length, 2, "eligible-workspaces and approve keep the hardcoded 'editar' gate");
});

Deno.test("mcp-oauth-consent: the grants gate splits list-grants ('ver') from revoke-grant ('editar')", () => {
  assertMatch(source, /const requiredAction = action === ["']list-grants["'] \? ["']ver["'] : ["']editar["']/);
  assertMatch(
    source,
    /hasPermissionFor\(svc,\s*user\.id,\s*contaId,\s*["']configuracoes["'],\s*requiredAction\)/,
  );
});

Deno.test("mcp-oauth-consent: list-grants/revoke-grant scope from profile.active_workspace_id, not profile.conta_id", () => {
  const block = source.match(/if \(action === ["']list-grants["'][\s\S]*?const contaId[\s\S]*?\n\s*\}/)?.[0] ?? "";
  assert(block.length > 0, "expected the list-grants/revoke-grant block");
  assertMatch(block, /\.select\(["']active_workspace_id["']\)/);
  assert(!/\.select\(["']role, conta_id["']\)/.test(block), "must not read the stale global profile.conta_id/role");
});

// --- eligible-workspaces: loop-filter by permission ---

async function eligibleWorkspaces(
  // deno-lint-ignore no-explicit-any
  svc: any,
  userId: string,
  memberships: Array<{ workspace_id: string }>,
): Promise<string[]> {
  const eligible: string[] = [];
  for (const m of memberships) {
    if (await hasPermissionFor(svc, userId, m.workspace_id, "configuracoes", "editar")) {
      eligible.push(m.workspace_id);
    }
  }
  return eligible;
}

Deno.test("eligible-workspaces: lists exactly the workspaces where the caller has configuracoes:editar", async () => {
  const svc = createSupabaseQueryMock();
  // ws-a: legacy owner (true), ws-b: legacy agent (false), ws-c: custom role WITH the key (true)
  svc.queueRpc("has_permission_for", { data: true, error: null });
  svc.queueRpc("has_permission_for", { data: false, error: null });
  svc.queueRpc("has_permission_for", { data: true, error: null });
  const result = await eligibleWorkspaces(svc, "u1", [
    { workspace_id: "ws-a" }, { workspace_id: "ws-b" }, { workspace_id: "ws-c" },
  ]);
  assertEquals(result, ["ws-a", "ws-c"]);
});

// --- approve: gate against the CHOSEN (payload) workspace ---

async function approveGate(
  // deno-lint-ignore no-explicit-any
  svc: any,
  userId: string,
  contaId: string,
): Promise<{ status: number }> {
  const canManage = await hasPermissionFor(svc, userId, contaId, "configuracoes", "editar");
  if (!canManage) return { status: 403 };
  return { status: 200 };
}

Deno.test("approve: legacy owner/admin on the chosen workspace -> allowed", async () => {
  const svc = createSupabaseQueryMock();
  svc.queueRpc("has_permission_for", { data: true, error: null });
  assertEquals((await approveGate(svc, "u1", "ws-a")).status, 200);
  const call = svc.calls.find((c: { table: string }) => c.table === "rpc:has_permission_for");
  assertEquals(call?.payload, { p_user: "u1", p_workspace: "ws-a", p_module: "configuracoes", p_action: "editar" });
});

Deno.test("approve: legacy agent on the chosen workspace -> refused", async () => {
  const svc = createSupabaseQueryMock();
  svc.queueRpc("has_permission_for", { data: false, error: null });
  assertEquals((await approveGate(svc, "u1", "ws-a")).status, 403);
});

Deno.test("approve: custom role (chassis 'agent') WITH configuracoes:editar -> allowed", async () => {
  const svc = createSupabaseQueryMock();
  svc.queueRpc("has_permission_for", { data: true, error: null });
  assertEquals((await approveGate(svc, "u1", "ws-a")).status, 200);
});

Deno.test("approve: custom role (chassis 'agent') WITHOUT configuracoes:editar -> refused", async () => {
  const svc = createSupabaseQueryMock();
  svc.queueRpc("has_permission_for", { data: false, error: null });
  assertEquals((await approveGate(svc, "u1", "ws-a")).status, 403);
});

Deno.test("approve: a non-member of the chosen workspace is refused (has_permission_for fails closed)", async () => {
  const svc = createSupabaseQueryMock();
  svc.queueRpc("has_permission_for", { data: false, error: null }); // no membership row -> v_role IS NULL -> false
  assertEquals((await approveGate(svc, "u1", "ws-a")).status, 403);
});

// --- list-grants / revoke-grant: gate against the ACTIVE workspace ---

async function activeWorkspaceGate(
  // deno-lint-ignore no-explicit-any
  svc: any,
  userId: string,
  profile: { active_workspace_id: string | null } | null,
  action = "revoke-grant",
): Promise<{ status: number; contaId?: string }> {
  const contaId = profile?.active_workspace_id as string | undefined;
  if (!contaId) return { status: 403 };
  const requiredAction = action === "list-grants" ? "ver" : "editar";
  const canManage = await hasPermissionFor(svc, userId, contaId, "configuracoes", requiredAction);
  if (!canManage) return { status: 403 };
  return { status: 200, contaId };
}

Deno.test("list/revoke-grant: legacy owner/admin of the active workspace -> allowed", async () => {
  const svc = createSupabaseQueryMock();
  svc.queueRpc("has_permission_for", { data: true, error: null });
  assertEquals(await activeWorkspaceGate(svc, "u1", { active_workspace_id: "ws-a" }), { status: 200, contaId: "ws-a" });
});

Deno.test("list/revoke-grant: legacy agent of the active workspace -> refused", async () => {
  const svc = createSupabaseQueryMock();
  svc.queueRpc("has_permission_for", { data: false, error: null });
  assertEquals((await activeWorkspaceGate(svc, "u1", { active_workspace_id: "ws-a" })).status, 403);
});

Deno.test("list/revoke-grant: custom role (chassis 'agent') WITH configuracoes:editar -> allowed", async () => {
  const svc = createSupabaseQueryMock();
  svc.queueRpc("has_permission_for", { data: true, error: null });
  assertEquals((await activeWorkspaceGate(svc, "u1", { active_workspace_id: "ws-a" })).status, 200);
});

Deno.test("list/revoke-grant: custom role (chassis 'agent') WITHOUT configuracoes:editar -> refused", async () => {
  const svc = createSupabaseQueryMock();
  svc.queueRpc("has_permission_for", { data: false, error: null });
  assertEquals((await activeWorkspaceGate(svc, "u1", { active_workspace_id: "ws-a" })).status, 403);
});

Deno.test("list/revoke-grant: no active workspace -> 403, no RPC call", async () => {
  const svc = createSupabaseQueryMock();
  assertEquals((await activeWorkspaceGate(svc, "u1", { active_workspace_id: null })).status, 403);
  assertEquals((await activeWorkspaceGate(svc, "u1", null)).status, 403);
  assertEquals(svc.calls.length, 0);
});

/**
 * Revisão externa (P2): the read/write split on the grants block. Asserting
 * the p_action actually sent, not just the status -- a regression that kept
 * demanding 'editar' would still pass a status-only check against a
 * permissive stub.
 */
Deno.test("list-grants: a ver-only role is allowed and asks for p_action 'ver'", async () => {
  const svc = createSupabaseQueryMock();
  svc.queueRpc("has_permission_for", { data: true, error: null });
  assertEquals(
    (await activeWorkspaceGate(svc, "u1", { active_workspace_id: "ws-a" }, "list-grants")).status,
    200,
  );
  const call = svc.calls.find((c: { table: string }) => c.table === "rpc:has_permission_for");
  assertEquals(call?.payload, {
    p_user: "u1",
    p_workspace: "ws-a",
    p_module: "configuracoes",
    p_action: "ver",
  });
});

Deno.test("revoke-grant: a ver-only role is refused, and the gate asks for 'editar'", async () => {
  const svc = createSupabaseQueryMock();
  svc.queueRpc("has_permission_for", { data: false, error: null });
  assertEquals(
    (await activeWorkspaceGate(svc, "u1", { active_workspace_id: "ws-a" }, "revoke-grant")).status,
    403,
  );
  const call = svc.calls.find((c: { table: string }) => c.table === "rpc:has_permission_for");
  assertEquals((call?.payload as { p_action: string }).p_action, "editar");
});

Deno.test("list-grants: a role with neither ver nor editar is still refused", async () => {
  const svc = createSupabaseQueryMock();
  svc.queueRpc("has_permission_for", { data: false, error: null });
  assertEquals(
    (await activeWorkspaceGate(svc, "u1", { active_workspace_id: "ws-a" }, "list-grants")).status,
    403,
  );
});
