export interface TargetRoleRow {
  id: string;
  nome: string;
}

export interface ResolveRoleUpdateInput {
  role?: unknown;
  roleId?: unknown;
  callerRole: string;
  targetRoleRow: TargetRoleRow | null;
}

export interface ResolveRoleUpdateError {
  error: string;
  status: number;
}

export interface ResolveRoleUpdateSuccess {
  update: { role: string; role_id: string | null };
  profileRole: string;
  // deno-lint-ignore no-explicit-any
  audit: Record<string, any>;
}

export type ResolveRoleUpdateResult = ResolveRoleUpdateError | ResolveRoleUpdateSuccess;

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALLOWED_ROLES = ["owner", "admin", "agent"];

/**
 * Pure decision function for manage-workspace-user's `update-role` action.
 *
 * `role` (preset: owner/admin/agent) and `roleId` (custom role) are mutually
 * exclusive. Assigning a custom role always writes the `agent` chassis role
 * to workspace_members/profiles alongside `role_id` -- custom roles never
 * change the coarse role column, they only attach permissions to the `agent`
 * floor. Assigning a preset always clears `role_id` back to null.
 *
 * Does not perform any I/O: the caller resolves `targetRoleRow` (the
 * workspace_roles row for `roleId`, scoped to the workspace, or null when not
 * found) up front and passes it in, and applies `update`/`profileRole`/`audit`
 * from the result.
 */
export function resolveRoleUpdate(input: ResolveRoleUpdateInput): ResolveRoleUpdateResult {
  const { role, roleId, callerRole, targetRoleRow } = input;

  const hasRole = role !== undefined && role !== null;
  const hasRoleId = roleId !== undefined && roleId !== null;

  if (hasRole && hasRoleId) {
    return { error: "role_and_role_id_exclusive", status: 400 };
  }
  if (!hasRole && !hasRoleId) {
    return { error: "role_required", status: 400 };
  }

  if (hasRole) {
    if (typeof role !== "string" || !ALLOWED_ROLES.includes(role)) {
      return { error: "role must be one of: owner, admin, agent", status: 400 };
    }
    if (role === "owner" && callerRole !== "owner") {
      return { error: "Only owner can assign owner role", status: 403 };
    }
    return {
      update: { role, role_id: null },
      profileRole: role,
      audit: { new_role: role },
    };
  }

  // hasRoleId branch
  if (typeof roleId !== "string" || !UUID_RE.test(roleId)) {
    return { error: "invalid_role_id", status: 400 };
  }
  if (!targetRoleRow) {
    return { error: "role_not_found", status: 404 };
  }

  return {
    update: { role: "agent", role_id: roleId },
    profileRole: "agent",
    audit: { new_role: "agent", role_id: roleId, role_nome: targetRoleRow.nome },
  };
}
