// apps/admin/src/pages/workspaces-params.ts
/**
 * Pure mapping between the Workspaces list URL (?q=&status=&ord=...) and both the typed
 * params object the page works with and the request sent to listWorkspaces(). Defaults
 * are never written to the URL; unknown values fall back to defaults silently.
 */
import type {
  ListWorkspacesParams,
  SortDir,
  WorkspaceActivityBucket,
  WorkspaceSortKey,
} from '../lib/api';
import { isStatusGroup, type WorkspaceStatusGroup } from '../lib/subscription';

export const PAGE_SIZES = [20, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
export type CreatedPreset = '' | '7d' | '30d' | '90d' | '12m';
export type OverridesFilter = '' | 'sim' | 'nao';

export interface WorkspacesListParams {
  q: string;
  plano: string;
  status: WorkspaceStatusGroup | '';
  overrides: OverridesFilter;
  atividade: WorkspaceActivityBucket | '';
  criado: CreatedPreset;
  ord: WorkspaceSortKey;
  dir: SortDir;
  /** 1-based. */
  pag: number;
  por: PageSize;
}

export const DEFAULT_PARAMS: WorkspacesListParams = {
  q: '',
  plano: '',
  status: '',
  overrides: '',
  atividade: '',
  criado: '',
  ord: 'created_at',
  dir: 'desc',
  pag: 1,
  por: 20,
};

export const FILTER_KEYS = ['q', 'plano', 'status', 'overrides', 'atividade', 'criado'] as const;

const ACTIVITY_BUCKETS: readonly WorkspaceActivityBucket[] = ['7d', '30d', 'dormente', 'nunca'];
const CREATED_PRESETS: readonly Exclude<CreatedPreset, ''>[] = ['7d', '30d', '90d', '12m'];
const SORT_KEYS: readonly WorkspaceSortKey[] = [
  'name',
  'plan',
  'client_count',
  'member_count',
  'created_at',
  'last_activity_at',
];

export const ACTIVITY_LABELS: Record<WorkspaceActivityBucket, string> = {
  '7d': 'Ativo (7 dias)',
  '30d': 'Ativo (30 dias)',
  dormente: 'Dormente (30d+)',
  nunca: 'Nunca ativou',
};

export const CREATED_LABELS: Record<Exclude<CreatedPreset, ''>, string> = {
  '7d': 'Últimos 7 dias',
  '30d': 'Últimos 30 dias',
  '90d': 'Últimos 90 dias',
  '12m': 'Últimos 12 meses',
};

export const OVERRIDES_LABELS: Record<Exclude<OverridesFilter, ''>, string> = {
  sim: 'Com overrides',
  nao: 'Sem overrides',
};

const CREATED_PRESET_DAYS: Record<Exclude<CreatedPreset, ''>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '12m': 365,
};

/** First click on a column header sorts this way; text columns ascend, numbers/dates descend. */
export const SORT_DEFAULT_DIR: Record<WorkspaceSortKey, SortDir> = {
  name: 'asc',
  plan: 'asc',
  client_count: 'desc',
  member_count: 'desc',
  created_at: 'desc',
  last_activity_at: 'desc',
};

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | null {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

export function parseWorkspacesParams(sp: URLSearchParams): WorkspacesListParams {
  const status = sp.get('status');
  const pag = Number.parseInt(sp.get('pag') ?? '', 10);
  const por = Number.parseInt(sp.get('por') ?? '', 10);
  return {
    q: sp.get('q') ?? '',
    plano: sp.get('plano') ?? '',
    status: status && isStatusGroup(status) ? status : '',
    overrides: oneOf(sp.get('overrides'), ['sim', 'nao'] as const) ?? '',
    atividade: oneOf(sp.get('atividade'), ACTIVITY_BUCKETS) ?? '',
    criado: oneOf(sp.get('criado'), CREATED_PRESETS) ?? '',
    ord: oneOf(sp.get('ord'), SORT_KEYS) ?? DEFAULT_PARAMS.ord,
    dir: oneOf(sp.get('dir'), ['asc', 'desc'] as const) ?? DEFAULT_PARAMS.dir,
    pag: Number.isFinite(pag) && pag >= 1 ? pag : 1,
    por: (PAGE_SIZES as readonly number[]).includes(por) ? (por as PageSize) : DEFAULT_PARAMS.por,
  };
}

export function serializeWorkspacesParams(p: WorkspacesListParams): URLSearchParams {
  const sp = new URLSearchParams();
  (Object.keys(DEFAULT_PARAMS) as (keyof WorkspacesListParams)[]).forEach((key) => {
    const value = p[key];
    if (value !== DEFAULT_PARAMS[key]) sp.set(key, String(value));
  });
  return sp;
}

export function toListWorkspacesRequest(p: WorkspacesListParams, now: Date): ListWorkspacesParams {
  const req: ListWorkspacesParams = {
    sort: p.ord,
    dir: p.dir,
    offset: (p.pag - 1) * p.por,
    limit: p.por,
  };
  if (p.q) req.search = p.q;
  if (p.plano) req.plan_id = p.plano;
  if (p.status) req.status = p.status;
  if (p.overrides) req.has_overrides = p.overrides === 'sim';
  if (p.atividade) req.activity = p.atividade;
  if (p.criado) {
    const since = new Date(now.getTime() - CREATED_PRESET_DAYS[p.criado] * 86_400_000);
    req.created_since = since.toISOString();
  }
  return req;
}

export function hasActiveFilters(p: WorkspacesListParams): boolean {
  return FILTER_KEYS.some((key) => p[key] !== DEFAULT_PARAMS[key]);
}

export function nextSort(
  current: Pick<WorkspacesListParams, 'ord' | 'dir'>,
  key: WorkspaceSortKey,
): Pick<WorkspacesListParams, 'ord' | 'dir'> {
  if (current.ord === key) return { ord: key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { ord: key, dir: SORT_DEFAULT_DIR[key] };
}
