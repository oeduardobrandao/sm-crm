// Helper puro extraído do callback do instagram-integration (que não tem DI e
// não é unit-testável diretamente). Fail-closed: o escopo opcional
// (instagram_business_manage_comments) só é registrado quando a Meta o
// devolve explicitamente no array `permissions` do token exchange -- ele
// NUNCA entra pelo fallback otimista do trio base.
import { IG_BASE_SCOPES } from "./instagram-scopes.ts";

export function resolveGrantedPermissions(reported: unknown): {
  permissions: string[];
  hasCommentsScope: boolean;
} {
  if (!Array.isArray(reported) || reported.length === 0) {
    return { permissions: [...IG_BASE_SCOPES], hasCommentsScope: false };
  }
  const permissions = reported.filter((p): p is string => typeof p === "string");
  return {
    permissions,
    hasCommentsScope: reported.includes("instagram_business_manage_comments"),
  };
}
