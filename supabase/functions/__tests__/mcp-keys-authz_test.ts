import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { hasPermissionFor } from "../_shared/permissions.ts";

// mcp-keys/index.ts wraps its handler in Deno.serve, which no test in this
// suite invokes directly (it would bind a real network listener). This file
// pairs a source-contract check (confirms index.ts actually wires the gate
// this way) with a mirror of the decision logic exercised against the REAL
// hasPermissionFor + a stubbed service client.
//
// Task 11: the gate moved from `profiles.role` (global, stale after a
// workspace switch) to `has_permission_for(user, active_workspace_id,
// 'configuracoes', 'editar')`.

function assertMatch(value: string, pattern: RegExp, msg?: string) {
  assert(pattern.test(value), msg ?? `Expected source to match ${pattern}`);
}

const source = await Deno.readTextFile(
  new URL("../mcp-keys/index.ts", import.meta.url),
);

Deno.test("mcp-keys: gate resolves active_workspace_id from profiles, then checks has_permission_for('configuracoes','editar')", () => {
  assertMatch(source, /import \{ hasPermissionFor \} from ["']\.\.\/_shared\/permissions\.ts["']/);
  assertMatch(source, /\.select\(["']active_workspace_id["']\)/);
  assertMatch(
    source,
    /hasPermissionFor\(svc,\s*user\.id,\s*contaId,\s*["']configuracoes["'],\s*["']editar["']\)/,
  );
  assert(
    !/\.select\(["']role, conta_id["']\)/.test(source),
    "the old profiles.role/conta_id select must be gone",
  );
  assert(
    !/profile\.role !== ["']owner["']/.test(source),
    "the old role-literal gate must be gone, not merely bypassed",
  );
});

/** Mirrors the gate in index.ts, against the REAL hasPermissionFor. */
async function gate(
  // deno-lint-ignore no-explicit-any
  svc: any,
  userId: string,
  profile: { active_workspace_id: string | null } | null,
): Promise<{ status: number; contaId?: string }> {
  if (!profile?.active_workspace_id) return { status: 403 };
  const contaId = profile.active_workspace_id;
  const canManage = await hasPermissionFor(svc, userId, contaId, "configuracoes", "editar");
  if (!canManage) return { status: 403 };
  return { status: 200, contaId };
}

Deno.test("no profile / no active workspace -> 403, no RPC call", async () => {
  const svc = createSupabaseQueryMock();
  assertEquals((await gate(svc, "u1", null)).status, 403);
  assertEquals((await gate(svc, "u1", { active_workspace_id: null })).status, 403);
  assertEquals(svc.calls.length, 0);
});

Deno.test("legacy owner/admin: has_permission_for('configuracoes','editar') resolves true", async () => {
  const svc = createSupabaseQueryMock();
  svc.queueRpc("has_permission_for", { data: true, error: null });
  const result = await gate(svc, "u1", { active_workspace_id: "ws-a" });
  assertEquals(result, { status: 200, contaId: "ws-a" });
  const call = svc.calls.find((c: { table: string }) => c.table === "rpc:has_permission_for");
  assertEquals(call?.payload, { p_user: "u1", p_workspace: "ws-a", p_module: "configuracoes", p_action: "editar" });
});

Deno.test("legacy agent: has_permission_for('configuracoes','editar') resolves false", async () => {
  const svc = createSupabaseQueryMock();
  svc.queueRpc("has_permission_for", { data: false, error: null });
  const result = await gate(svc, "u1", { active_workspace_id: "ws-a" });
  assertEquals(result.status, 403);
});

Deno.test("custom role (chassis 'agent') WITH configuracoes:editar -> allowed", async () => {
  const svc = createSupabaseQueryMock();
  svc.queueRpc("has_permission_for", { data: true, error: null });
  assertEquals((await gate(svc, "u1", { active_workspace_id: "ws-a" })).status, 200);
});

Deno.test("custom role (chassis 'agent') WITHOUT configuracoes:editar -> refused", async () => {
  const svc = createSupabaseQueryMock();
  svc.queueRpc("has_permission_for", { data: false, error: null });
  assertEquals((await gate(svc, "u1", { active_workspace_id: "ws-a" })).status, 403);
});
