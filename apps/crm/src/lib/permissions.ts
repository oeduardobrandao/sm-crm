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
 * Espelho EXATO do preset agente hardcoded em public.has_permission_for
 * (migration 20260903000002, bloco "agent: preset hardcoded"). O único outro
 * mirror TS é este arquivo — supabase/functions/_shared/permissions.ts NÃO
 * tem um preset próprio: aquele módulo é só catálogo + validação de payload
 * mais um wrapper que delega para o RPC has_permission_for, que é quem
 * decide a resolução de fato. Mudou o preset na SQL, muda aqui, e o teste de
 * paridade (TT-05..08) + o pgTAP 72 precisam mudar juntos.
 */
// automacoes: 'editar' (não 'ver'). Migração B (20260904000001) remapeou o
// módulo: post_status_automations agora segue 'configuracoes' (já 'none'
// aqui, owner/admin-only preservado sem tocar em nada), e 'automacoes'
// passou a governar só instagram_comment_automations -- que já dava escrita
// livre a QUALQUER membro, agente incluso, desde 20260829000002. 'editar' é
// o nível que preserva essa escrita byte a byte; 'ver' teria revogado o que
// o agente já tinha.
export const AGENT_ROLE_PRESET: Record<PermissionModule, PermissionLevel> = {
  clientes: 'editar',
  entregas: 'editar',
  calendario: 'editar',
  aprovacoes: 'editar',
  arquivos: 'editar',
  ideias: 'editar',
  tarefas: 'editar',
  analytics: 'ver',
  automacoes: 'editar',
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

/**
 * Espelho TS de public.has_permission_for. Tabela-verdade única: TT-01..16.
 *
 * A branch de papel customizado chaveia em `role_id !== null`, NÃO em
 * `permissions !== null`. `role_id` é quem determina "este membro tem um
 * papel customizado atribuído"; `permissions` é só o conteúdo lido junto via
 * embed (`workspace_roles(permissions)` em getMyMembership()). Se o embed
 * falhar ou vier vazio por qualquer motivo (RLS, linha deletada entre o
 * momento do JOIN e o de leitura, hiccup de rede) o `role_id` continua
 * não-nulo mas `permissions` pode chegar aqui como `null`/`undefined` — e
 * essa combinação TEM que negar tudo (`?? 'none'` abaixo), nunca cair para o
 * fallback legado. Chavear em `permissions !== null` (versão anterior deste
 * arquivo) fazia exatamente isso: uma falha de embed com role_id presente
 * caía no fallback `agent`/AGENT_ROLE_PRESET, que libera 'editar' em 7
 * módulos — um fail-OPEN de escalonamento de privilégio para quem deveria
 * estar restrito a um papel customizado. `membership.permissions?.[module]`
 * (optional chaining) também mantém a função total: nunca lança para nenhum
 * formato de `membership`, mesmo um `permissions: undefined` fora do tipo.
 */
export function derivePermission(
  membership: MyMembership | null,
  module: PermissionModule,
  action: PermissionAction,
): PermissionCheck {
  if (!membership) return 'unknown';
  if (!(PERMISSION_MODULES as readonly string[]).includes(module)) return false;
  if (membership.role === 'owner') return true;
  if (membership.role_id !== null) {
    return levelAllows(membership.permissions?.[module] ?? 'none', action);
  }
  if (membership.role === 'admin') {
    // Migração B (20260904000001_workspace_roles_b_enforcement.sql, item 2):
    // contratos entra na mesma exceção de financeiro. Fato de produção: um
    // admin restrito (can_see_financials=false) já não vê contratos hoje —
    // nav-data.ts esconde os dois itens juntos para admin restrito, e a RLS
    // legada de contratos_select usava can_see_financials() diretamente,
    // igual a transacoes. Espelho SQL: public.has_permission_for, ramo
    // 'admin' (`p_module IN ('financeiro', 'contratos')`).
    if (module === 'financeiro' || module === 'contratos') return membership.can_see_financials;
    return true;
  }
  return levelAllows(AGENT_ROLE_PRESET[module], action);
}

/**
 * Generalizes the financial-only live-revocation purge (AuthContext's
 * FINANCIAL_QUERY_KEYS block) to EVERY module: compares `derivePermission(_,
 * module, 'ver')` before vs. after a membership change, module by module —
 * never a coarse "role changed" or "permissions object changed" comparison,
 * which would flag every module as transitioned on ANY edit (e.g. a papel
 * losing `leads` alone would wrongly look like it also lost `clientes`).
 *
 * `'ver'` only: this feeds a cache-purge decision (can the user still list
 * this module's data at all), not an edit-capability check — a
 * `editar` -> `ver` narrowing never needs to blow away a query cache the
 * user can still legitimately read.
 *
 * A transition is:
 * - downgraded: was exactly `true`, now `false` or `'unknown'` — mirrors the
 *   financial purge's own `previous !== nowAllowed` guard reasoning (see
 *   AuthContext.tsx's applyMembership): `'unknown'` is not `true` either, so
 *   the very first resolution into a restricted state (never having been
 *   granted at all) still counts as a downgrade that must purge.
 * - upgraded: was `false` or `'unknown'`, now exactly `true`.
 * - anything else (true -> true, false -> false, 'unknown' -> 'unknown',
 *   false <-> 'unknown') is not a transition — neither list gets the module.
 *
 * Order in each returned array follows `PERMISSION_MODULES`, not caller
 * input order — callers should treat both as unordered sets.
 */
export function computePermissionTransitions(
  prev: MyMembership | null,
  next: MyMembership | null,
): { downgraded: PermissionModule[]; upgraded: PermissionModule[] } {
  const downgraded: PermissionModule[] = [];
  const upgraded: PermissionModule[] = [];
  for (const module of PERMISSION_MODULES) {
    const before = derivePermission(prev, module, 'ver');
    const after = derivePermission(next, module, 'ver');
    if (before === after) continue;
    if (before === true) downgraded.push(module);
    else if (after === true) upgraded.push(module);
  }
  return { downgraded, upgraded };
}
