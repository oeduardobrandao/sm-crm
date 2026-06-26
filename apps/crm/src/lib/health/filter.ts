import type { ClientHealth } from '../../services/clientHealth';
import type { HealthStatus } from './score';

export type HealthFilterKey = 'todos' | 'atencao' | 'saudaveis' | 'estaveis' | 'conexao';
export type HealthSort = 'atencao' | 'engajamento' | 'ultimo_post' | 'seguidores' | 'nome';

const GROUPS: Record<Exclude<HealthFilterKey, 'todos'>, HealthStatus[]> = {
  atencao: ['em_queda', 'atencao', 'inativo'],
  saudaveis: ['em_alta', 'saudavel'],
  estaveis: ['estavel'],
  conexao: ['desconectado', 'reconectar', 'sem_sincronizar', 'sincronizando', 'sem_dados'],
};

// Actionable override states sort to the very top under the default sort.
const ATTENTION_OVERRIDES: HealthStatus[] = ['reconectar', 'sem_sincronizar', 'desconectado', 'inativo'];
// Transient/neutral states sort after the scored tiers.
const NEUTRAL_OVERRIDES: HealthStatus[] = ['sincronizando', 'sem_dados'];
// assumes health scores are 0–100

export function matchesFilter(status: HealthStatus, key: HealthFilterKey): boolean {
  if (key === 'todos') return true;
  return GROUPS[key].includes(status);
}

// Lower = more urgent (sorts first) for the default "precisam de atenção" order.
function attentionRank(c: ClientHealth): number {
  if (ATTENTION_OVERRIDES.includes(c.status)) return -1; // most urgent
  if (NEUTRAL_OVERRIDES.includes(c.status)) return 200; // least urgent
  return c.score ?? 100; // scored tiers: lower score first
}

export function filterAndSortClients(
  clients: ClientHealth[],
  opts: { filter: HealthFilterKey; search: string; sort: HealthSort },
): ClientHealth[] {
  const q = opts.search.trim().toLowerCase();
  const filtered = clients.filter((c) => {
    if (!matchesFilter(c.status, opts.filter)) return false;
    if (!q) return true;
    return (
      c.client_name.toLowerCase().includes(q) || (c.username ?? '').toLowerCase().includes(q)
    );
  });

  const byName = (a: ClientHealth, b: ClientHealth) =>
    a.client_name.localeCompare(b.client_name, 'pt-BR');

  const sorted = [...filtered];
  switch (opts.sort) {
    case 'atencao':
      sorted.sort((a, b) => attentionRank(a) - attentionRank(b) || byName(a, b));
      break;
    case 'engajamento':
      sorted.sort((a, b) => b.engagement_rate - a.engagement_rate || byName(a, b));
      break;
    case 'ultimo_post':
      // most stale first; nulls (no posts) treated as most stale
      sorted.sort(
        (a, b) => (b.days_since_last_post ?? Infinity) - (a.days_since_last_post ?? Infinity) || byName(a, b), // both-null → Infinity - Infinity = NaN, falls through to byName
      );
      break;
    case 'seguidores':
      sorted.sort((a, b) => b.follower_count - a.follower_count || byName(a, b));
      break;
    case 'nome':
      sorted.sort(byName);
      break;
  }
  return sorted;
}
