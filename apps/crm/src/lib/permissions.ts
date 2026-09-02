import type { MyMembership } from '@/store/workspace';

export const PERMISSION_MODULES = [
  'clientes',
  'entregas',
  'calendario',
  'aprovacoes',
  'arquivos',
  'ideias',
  'tarefas',
  'leads',
  'financeiro',
  'contratos',
  'equipe',
  'analytics',
  'automacoes',
  'configuracoes',
] as const;
export type PermissionModule = (typeof PERMISSION_MODULES)[number];
export type PermissionAction = 'ver' | 'editar';
export type PermissionLevel = 'none' | 'ver' | 'editar';
/** 'unknown' = membership não resolvida: rotas falham neutro, valores fecham. */
export type PermissionCheck = boolean | 'unknown';

/**
 * Espelho EXATO do preset agente hardcoded em public.has_permission_for e em
 * supabase/functions/_shared/permissions.ts. Mudou lá, muda aqui, e o teste
 * de paridade (TT-05..08) + o pgTAP 72 precisam mudar juntos.
 */
export const AGENT_PRESET: Record<PermissionModule, PermissionLevel> = {
  clientes: 'editar',
  entregas: 'editar',
  calendario: 'editar',
  aprovacoes: 'editar',
  arquivos: 'editar',
  ideias: 'editar',
  tarefas: 'editar',
  analytics: 'ver',
  automacoes: 'ver',
  leads: 'none',
  financeiro: 'none',
  contratos: 'none',
  equipe: 'none',
  configuracoes: 'none',
};

const LEVELS = new Set<string>(['none', 'ver', 'editar']);

function levelAllows(level: string | undefined, action: PermissionAction): boolean {
  if (!level || !LEVELS.has(level)) return false;
  return level === 'editar' || (level === 'ver' && action === 'ver');
}

/** Espelho TS de public.has_permission_for. Tabela-verdade única: TT-01..16. */
export function derivePermission(
  membership: MyMembership | null,
  module: PermissionModule,
  action: PermissionAction,
): PermissionCheck {
  if (!membership) return 'unknown';
  if (!(PERMISSION_MODULES as readonly string[]).includes(module)) return false;
  if (membership.role === 'owner') return true;
  if (membership.permissions !== null) {
    return levelAllows(membership.permissions[module] ?? 'none', action);
  }
  if (membership.role === 'admin') {
    if (module === 'financeiro') return membership.can_see_financials;
    return true;
  }
  return levelAllows(AGENT_PRESET[module], action);
}
