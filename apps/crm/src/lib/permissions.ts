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
export const AGENT_ROLE_PRESET: Record<PermissionModule, PermissionLevel> = {
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
    if (module === 'financeiro') return membership.can_see_financials;
    return true;
  }
  return levelAllows(AGENT_ROLE_PRESET[module], action);
}
