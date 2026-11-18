// apps/admin/src/pages/workspaces-params.ts
/**
 * Pure mapping between the Workspaces list URL (?q=&status=&ord=...) and both the typed
 * params object the page works with and the request sent to listWorkspaces(). Defaults
 * are never written to the URL; unknown values fall back to defaults silently.
 *
 * Plano, Status and Atividade are multi-select: comma-separated in the URL
 * (`?status=ativo,teste`), arrays here, and sent to the RPC as the same comma list (OR
 * within a filter, AND across filters). Lists are deduped and kept in a canonical order, so
 * the URL and the query key never depend on the order the boxes were ticked.
 */
import type {
  ListWorkspacesParams,
  SortDir,
  WorkspaceActivityBucket,
  WorkspaceSortKey,
} from '../lib/api';
import { STATUS_GROUPS, type WorkspaceStatusGroup } from '../lib/subscription';

export const PAGE_SIZES = [20, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
export type CreatedPreset = '' | '7d' | '30d' | '90d' | '12m';
export type OverridesFilter = '' | 'sim' | 'nao';

export interface WorkspacesListParams {
  q: string;
  /** Plan ids; empty = every plan. */
  plano: string[];
  /** Empty = every status. */
  status: WorkspaceStatusGroup[];
  overrides: OverridesFilter;
  /** Empty = any activity. */
  atividade: WorkspaceActivityBucket[];
  criado: CreatedPreset;
  ord: WorkspaceSortKey;
  dir: SortDir;
  /** 1-based. */
  pag: number;
  por: PageSize;
}

export const DEFAULT_PARAMS: WorkspacesListParams = {
  q: '',
  plano: [],
  status: [],
  overrides: '',
  atividade: [],
  criado: '',
  ord: 'created_at',
  dir: 'desc',
  pag: 1,
  por: 20,
};

export const FILTER_KEYS = ['q', 'plano', 'status', 'overrides', 'atividade', 'criado'] as const;

/** The multi-select filters (arrays in the params object, comma lists in the URL). */
export type MultiFilterKey = 'plano' | 'status' | 'atividade';

export const ACTIVITY_BUCKETS: readonly WorkspaceActivityBucket[] = [
  '7d',
  '30d',
  'dormente',
  'nunca',
];
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

/** Deduped, in `order`'s order when given (unknown values dropped), else sorted. */
function canonicalList<T extends string>(values: readonly string[], order?: readonly T[]): T[] {
  const set = new Set(values.map((v) => v.trim()).filter((v) => v !== ''));
  if (order) return order.filter((v) => set.has(v));
  return [...set].sort() as T[];
}

function parseList<T extends string>(value: string | null, order?: readonly T[]): T[] {
  return value === null ? [] : canonicalList(value.split(','), order);
}

function canonicalPlano(values: readonly string[]): string[] {
  // Plan ids come from the plans table, so they are sorted rather than validated. The URL
  // and the RPC both split on commas: a plan id containing one could not be filtered (ids
  // are slugs like `pro` in practice).
  return canonicalList(values);
}

/** `list` with `value` added (if missing) or removed (if present); serializing reorders it. */
export function toggleInList<T extends string>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/**
 * A params patch, or a function of the latest params that returns one. Toggling a value in a
 * multi-select filter must use the function form: two quick clicks both land before the URL
 * update re-renders, so a list read from props would make the second click drop the first.
 */
export type WorkspacesParamsPatch =
  | Partial<WorkspacesListParams>
  | ((latest: WorkspacesListParams) => Partial<WorkspacesListParams>);

/**
 * Replays on `latest` the one change a list widget made going from `seen` to `next` (it
 * computes `next` from the props it rendered with, which may be stale). An empty `next` is
 * the widget's "clear all" row.
 */
export function rebaseListChange<T extends string>(
  latest: readonly T[],
  seen: readonly T[],
  next: readonly T[],
): T[] {
  if (next.length === 0) return [];
  const changed = [
    ...next.filter((v) => !seen.includes(v)),
    ...seen.filter((v) => !next.includes(v)),
  ];
  return changed.reduce<T[]>((list, v) => toggleInList(list, v), [...latest]);
}

function isDefaultValue<K extends keyof WorkspacesListParams>(
  key: K,
  value: WorkspacesListParams[K],
): boolean {
  return Array.isArray(value) ? value.length === 0 : value === DEFAULT_PARAMS[key];
}

export function parseWorkspacesParams(sp: URLSearchParams): WorkspacesListParams {
  const pag = Number.parseInt(sp.get('pag') ?? '', 10);
  const por = Number.parseInt(sp.get('por') ?? '', 10);
  return {
    q: sp.get('q') ?? '',
    plano: canonicalPlano(parseList(sp.get('plano'))),
    status: parseList(sp.get('status'), STATUS_GROUPS),
    overrides: oneOf(sp.get('overrides'), ['sim', 'nao'] as const) ?? '',
    atividade: parseList(sp.get('atividade'), ACTIVITY_BUCKETS),
    criado: oneOf(sp.get('criado'), CREATED_PRESETS) ?? '',
    ord: oneOf(sp.get('ord'), SORT_KEYS) ?? DEFAULT_PARAMS.ord,
    dir: oneOf(sp.get('dir'), ['asc', 'desc'] as const) ?? DEFAULT_PARAMS.dir,
    pag: Number.isFinite(pag) && pag >= 1 ? pag : 1,
    por: (PAGE_SIZES as readonly number[]).includes(por) ? (por as PageSize) : DEFAULT_PARAMS.por,
  };
}

export function serializeWorkspacesParams(p: WorkspacesListParams): URLSearchParams {
  const sp = new URLSearchParams();
  const canonical: WorkspacesListParams = {
    ...p,
    plano: canonicalPlano(p.plano),
    status: canonicalList(p.status, STATUS_GROUPS),
    atividade: canonicalList(p.atividade, ACTIVITY_BUCKETS),
  };
  (Object.keys(DEFAULT_PARAMS) as (keyof WorkspacesListParams)[]).forEach((key) => {
    const value = canonical[key];
    if (isDefaultValue(key, value)) return;
    sp.set(key, Array.isArray(value) ? value.join(',') : String(value));
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
  if (p.plano.length) req.plan_id = canonicalPlano(p.plano).join(',');
  if (p.status.length) req.status = canonicalList(p.status, STATUS_GROUPS).join(',');
  if (p.overrides) req.has_overrides = p.overrides === 'sim';
  if (p.atividade.length) req.activity = canonicalList(p.atividade, ACTIVITY_BUCKETS).join(',');
  if (p.criado) {
    const since = new Date(now.getTime() - CREATED_PRESET_DAYS[p.criado] * 86_400_000);
    req.created_since = since.toISOString();
  }
  return req;
}

export function hasActiveFilters(p: WorkspacesListParams): boolean {
  return FILTER_KEYS.some((key) => !isDefaultValue(key, p[key]));
}

/** The filters the phone sheet owns: everything but the search text, which has its own field. */
export const SHEET_FILTER_KEYS = ['plano', 'status', 'overrides', 'atividade', 'criado'] as const;

/**
 * How many of the sheet's filters are active (the badge on the Filtros button). Counts
 * filters, not values: Status with two groups ticked is one.
 */
export function countSheetFilters(p: WorkspacesListParams): number {
  return SHEET_FILTER_KEYS.filter((key) => !isDefaultValue(key, p[key])).length;
}

/** A patch that clears the sheet's filters and leaves the search text alone. */
export function clearSheetFiltersPatch(): Partial<WorkspacesListParams> {
  return {
    plano: DEFAULT_PARAMS.plano,
    status: DEFAULT_PARAMS.status,
    overrides: DEFAULT_PARAMS.overrides,
    atividade: DEFAULT_PARAMS.atividade,
    criado: DEFAULT_PARAMS.criado,
  };
}

export function nextSort(
  current: Pick<WorkspacesListParams, 'ord' | 'dir'>,
  key: WorkspaceSortKey,
): Pick<WorkspacesListParams, 'ord' | 'dir'> {
  if (current.ord === key) return { ord: key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { ord: key, dir: SORT_DEFAULT_DIR[key] };
}
