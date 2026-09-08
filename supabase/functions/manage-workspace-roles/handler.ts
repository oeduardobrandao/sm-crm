import { validateRolePermissions } from "../_shared/permissions.ts";

interface RpcClient {
  // PromiseLike, not Promise: supabase-js's real .rpc() returns a
  // PostgrestFilterBuilder (thenable but missing catch/finally), which is
  // only structurally assignable to the looser PromiseLike shape.
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data?: unknown; error?: { message: string } | null }>;
}

export interface RoleActionDeps {
  svc: RpcClient;
}

export interface RoleActionBody {
  action?: string;
  roleId?: string;
  nome?: string;
  permissions?: Record<string, unknown>;
}

export interface RoleActionInput {
  userId: string;
  workspaceId: string;
  body: RoleActionBody;
}

export interface RoleActionResult {
  status: number;
  // deno-lint-ignore no-explicit-any
  body: Record<string, any>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Pure logic for manage-workspace-roles, dependency-injected (deps.svc) so it
 * can be driven directly in tests. All owner authorization lives in the RPC
 * (create/update/delete_workspace_role), which resolves the caller from
 * workspace_members — this handler never checks the role itself, avoiding a
 * second copy of that check that could drift from the RPC's.
 *
 * Never returns a raw RPC error message to the caller: any error.message that
 * isn't one of the known sentinel codes is logged internally and mapped to a
 * generic "Internal server error" (house security rule, CLAUDE.md).
 */
export async function handleRoleAction(
  deps: RoleActionDeps,
  input: RoleActionInput,
): Promise<RoleActionResult> {
  const { userId, workspaceId, body } = input;
  const action = body?.action;

  if (action === "create") {
    const nome = body.nome;
    if (typeof nome !== "string" || nome.trim() === "") {
      return { status: 400, body: { error: "invalid_name" } };
    }
    const permissions = body.permissions ?? {};
    if (validateRolePermissions(permissions) !== null) {
      return { status: 400, body: { error: "invalid_permissions" } };
    }

    const { data, error } = await deps.svc.rpc("create_workspace_role", {
      p_actor: userId,
      p_workspace: workspaceId,
      p_nome: nome,
      p_permissions: permissions,
    });
    if (error) return mapRpcError(error);
    return { status: 200, body: { role_id: data } };
  }

  if (action === "update") {
    const roleId = body.roleId;
    if (typeof roleId !== "string" || !UUID_RE.test(roleId)) {
      return { status: 400, body: { error: "invalid_role_id" } };
    }
    const nome = body.nome;
    if (typeof nome !== "string" || nome.trim() === "") {
      return { status: 400, body: { error: "invalid_name" } };
    }
    const permissions = body.permissions ?? {};
    if (validateRolePermissions(permissions) !== null) {
      return { status: 400, body: { error: "invalid_permissions" } };
    }

    const { data, error } = await deps.svc.rpc("update_workspace_role", {
      p_actor: userId,
      p_workspace: workspaceId,
      p_role: roleId,
      p_nome: nome,
      p_permissions: permissions,
    });
    if (error) return mapRpcError(error);
    return {
      status: 200,
      body: { message: data === "noop" ? "Nenhuma alteração." : "Papel atualizado com sucesso." },
    };
  }

  if (action === "delete") {
    const roleId = body.roleId;
    if (typeof roleId !== "string" || !UUID_RE.test(roleId)) {
      return { status: 400, body: { error: "invalid_role_id" } };
    }

    const { error } = await deps.svc.rpc("delete_workspace_role", {
      p_actor: userId,
      p_workspace: workspaceId,
      p_role: roleId,
    });
    if (error) return mapRpcError(error);
    return { status: 200, body: { message: "Papel excluído com sucesso." } };
  }

  return { status: 400, body: { error: "invalid_action" } };
}

function mapRpcError(error: { message: string }): RoleActionResult {
  const m = error.message ?? "";
  if (m.includes("not_owner")) return { status: 403, body: { error: "not_owner" } };
  if (m.includes("invalid_name")) return { status: 400, body: { error: "invalid_name" } };
  if (m.includes("invalid_permissions")) return { status: 400, body: { error: "invalid_permissions" } };
  if (m.includes("duplicate_name")) return { status: 409, body: { error: "duplicate_name" } };
  if (m.includes("role_in_use")) return { status: 409, body: { error: "role_in_use" } };
  if (m.includes("role_not_found")) return { status: 404, body: { error: "role_not_found" } };

  console.error("[manage-workspace-roles] rpc failed:", m);
  return { status: 500, body: { error: "Internal server error" } };
}
