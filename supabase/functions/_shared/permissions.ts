// Catálogo de permissões e wrapper do RPC has_permission_for.
// Espelhos: public.validate_role_permissions / has_permission_for (SQL) e
// apps/crm/src/lib/permissions.ts (frontend). Paridade coberta por teste.
export const PERMISSION_MODULES = [
  "clientes", "entregas", "calendario", "aprovacoes", "arquivos", "ideias",
  "tarefas", "leads", "financeiro", "contratos", "equipe", "analytics",
  "automacoes", "configuracoes",
] as const;
export type PermissionModule = (typeof PERMISSION_MODULES)[number];
export type PermissionLevel = "none" | "ver" | "editar";
export type PermissionAction = "ver" | "editar";

const LEVELS: ReadonlySet<string> = new Set(["none", "ver", "editar"]);
const MODULES: ReadonlySet<string> = new Set(PERMISSION_MODULES);

export function validateRolePermissions(input: unknown): string | null {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return "invalid_shape";
  }
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!MODULES.has(k)) return "invalid_module";
    if (typeof v !== "string" || !LEVELS.has(v)) return "invalid_level";
  }
  return null;
}

/**
 * Permissão de um usuário num workspace EXPLÍCITO, resolvida pelo núcleo SQL
 * (única fonte de verdade backend). Falha FECHADA: qualquer erro nega.
 */
export async function hasPermissionFor(
  // deno-lint-ignore no-explicit-any
  svc: any,
  userId: string,
  workspaceId: string,
  module: PermissionModule | string,
  action: PermissionAction,
): Promise<boolean> {
  try {
    const { data, error } = await svc.rpc("has_permission_for", {
      p_user: userId, p_workspace: workspaceId,
      p_module: module, p_action: action,
    });
    if (error) {
      console.error("[permissions:hasPermissionFor]", error);
      return false;
    }
    return data === true;
  } catch (e) {
    console.error("[permissions:hasPermissionFor]", e);
    return false;
  }
}
