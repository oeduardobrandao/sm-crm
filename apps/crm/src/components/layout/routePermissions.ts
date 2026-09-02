import type { PermissionAction, PermissionModule } from '@/lib/permissions';

export type RouteGate =
  { module: PermissionModule; action: PermissionAction } | 'open' | 'unmapped';

interface RouteRule {
  prefix: string;
  gate: { module: PermissionModule; action: PermissionAction } | 'open';
}

/**
 * Every authenticated route from App.tsx (routes 126-236), plus `/aprovacoes`
 * (a real `PermissionModule`, but no CRM route mounts it today — kept here so
 * the table is future-proof and matches the plan's full route table). Order
 * doesn't matter for correctness: `resolveRouteGate` picks the LONGEST
 * matching prefix, and matching itself is segment-boundary aware (see below),
 * so `/analytics` vs `/analytics-fluxos` can never cross-match regardless of
 * list order.
 */
const ROUTES: RouteRule[] = [
  { prefix: '/ajuda', gate: 'open' },
  { prefix: '/dashboard', gate: 'open' },
  { prefix: '/configuracao', gate: 'open' },
  { prefix: '/comecar', gate: 'open' },
  { prefix: '/workspace-setup', gate: 'open' },
  { prefix: '/oauth/consent', gate: 'open' },

  { prefix: '/clientes', gate: { module: 'clientes', action: 'ver' } },
  // The `financeiro` sub-tab under /clientes/:id has its own, finer-grained
  // gate in clienteTabs.model.ts — this route-level gate is the PARENT
  // module's, shared by every tab.
  { prefix: '/entregas', gate: { module: 'entregas', action: 'ver' } },
  { prefix: '/post-express', gate: { module: 'entregas', action: 'ver' } },
  { prefix: '/calendario', gate: { module: 'calendario', action: 'ver' } },
  { prefix: '/aprovacoes', gate: { module: 'aprovacoes', action: 'ver' } },
  { prefix: '/arquivos', gate: { module: 'arquivos', action: 'ver' } },
  { prefix: '/ideias', gate: { module: 'ideias', action: 'ver' } },
  { prefix: '/tarefas', gate: { module: 'tarefas', action: 'ver' } },
  { prefix: '/leads', gate: { module: 'leads', action: 'ver' } },
  { prefix: '/financeiro', gate: { module: 'financeiro', action: 'ver' } },
  { prefix: '/contratos', gate: { module: 'contratos', action: 'ver' } },
  { prefix: '/equipe', gate: { module: 'equipe', action: 'ver' } },
  { prefix: '/analytics-fluxos', gate: { module: 'analytics', action: 'ver' } },
  { prefix: '/analytics', gate: { module: 'analytics', action: 'ver' } },
  { prefix: '/relatorios', gate: { module: 'analytics', action: 'ver' } },
  { prefix: '/mensagens', gate: { module: 'clientes', action: 'ver' } },
  { prefix: '/automacoes', gate: { module: 'automacoes', action: 'ver' } },
  { prefix: '/importar', gate: { module: 'clientes', action: 'editar' } },
];

/**
 * Resolves the route-level permission gate for a pathname.
 *
 * Matching is by PREFIX with a segment boundary: `/clientes` matches
 * `/clientes/42` but NOT `/clientesx` — the character right after the prefix
 * must be `/` or the pathname must end exactly there. Among all prefixes that
 * match, the LONGEST one wins (defensive; today's table has no prefix that is
 * itself a proper sub-path of another, since the boundary rule alone already
 * disambiguates every real case, e.g. `/analytics` vs `/analytics-fluxos`).
 *
 * An authenticated route with no entry here resolves 'unmapped' — callers
 * (ProtectedRoute) treat that as deny-by-default, never open-by-default.
 */
export function resolveRouteGate(
  pathname: string,
): { module: PermissionModule; action: PermissionAction } | 'open' | 'unmapped' {
  let best: RouteRule | null = null;
  for (const rule of ROUTES) {
    if (!pathname.startsWith(rule.prefix)) continue;
    const boundary = pathname.charAt(rule.prefix.length);
    if (boundary !== '' && boundary !== '/') continue;
    if (!best || rule.prefix.length > best.prefix.length) best = rule;
  }
  return best ? best.gate : 'unmapped';
}
