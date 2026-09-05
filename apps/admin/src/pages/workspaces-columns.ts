import type { WorkspaceSortKey } from '../lib/api';

export type WorkspaceColumnKey =
  | 'name'
  | 'owner'
  | 'plan'
  | 'subscription'
  | 'client_count'
  | 'member_count'
  | 'created_at'
  | 'last_activity_at';

export interface WorkspaceColumn {
  key: WorkspaceColumnKey;
  label: string;
  /** Present when the header is sortable. */
  sortKey?: WorkspaceSortKey;
  hideable: boolean;
  numeric?: boolean;
}

export const WORKSPACE_COLUMNS: readonly WorkspaceColumn[] = [
  { key: 'name', label: 'Workspace', sortKey: 'name', hideable: false },
  { key: 'owner', label: 'Dono', hideable: true },
  { key: 'plan', label: 'Plano', sortKey: 'plan', hideable: true },
  { key: 'subscription', label: 'Assinatura', hideable: true },
  {
    key: 'client_count',
    label: 'Clientes',
    sortKey: 'client_count',
    hideable: true,
    numeric: true,
  },
  { key: 'member_count', label: 'Membros', sortKey: 'member_count', hideable: true, numeric: true },
  { key: 'created_at', label: 'Criado em', sortKey: 'created_at', hideable: true },
  {
    key: 'last_activity_at',
    label: 'Última atividade',
    sortKey: 'last_activity_at',
    hideable: true,
  },
];

export type Density = 'confortavel' | 'compacta';
export const DENSITY_LABELS: Record<Density, string> = {
  confortavel: 'Confortável',
  compacta: 'Compacta',
};

export interface ColumnPrefs {
  visible: WorkspaceColumnKey[];
  density: Density;
}

export const DEFAULT_COLUMN_PREFS: ColumnPrefs = {
  visible: WORKSPACE_COLUMNS.map((c) => c.key),
  density: 'confortavel',
};

export const COLUMNS_STORAGE_KEY = 'admin.workspaces.columns';
export const DENSITY_STORAGE_KEY = 'admin.workspaces.density';

const KNOWN_KEYS = new Set<string>(WORKSPACE_COLUMNS.map((c) => c.key));

function defaultPrefs(): ColumnPrefs {
  return { visible: [...DEFAULT_COLUMN_PREFS.visible], density: DEFAULT_COLUMN_PREFS.density };
}

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Keeps registry order and forces every non-hideable column in. */
function normalizeVisible(keys: string[]): WorkspaceColumnKey[] {
  const wanted = new Set(keys.filter((k) => KNOWN_KEYS.has(k)));
  return WORKSPACE_COLUMNS.filter((c) => !c.hideable || wanted.has(c.key)).map((c) => c.key);
}

export function readColumnPrefs(storage: Storage | null = defaultStorage()): ColumnPrefs {
  if (!storage) return defaultPrefs();
  try {
    const rawCols = storage.getItem(COLUMNS_STORAGE_KEY);
    const parsed: unknown = rawCols ? JSON.parse(rawCols) : null;
    const visible = Array.isArray(parsed)
      ? normalizeVisible(parsed.filter((k): k is string => typeof k === 'string'))
      : [...DEFAULT_COLUMN_PREFS.visible];
    const rawDensity = storage.getItem(DENSITY_STORAGE_KEY);
    const density: Density = rawDensity === 'compacta' ? 'compacta' : 'confortavel';
    return { visible, density };
  } catch {
    return defaultPrefs();
  }
}

export function writeColumnPrefs(
  prefs: ColumnPrefs,
  storage: Storage | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(prefs.visible));
    storage.setItem(DENSITY_STORAGE_KEY, prefs.density);
  } catch {
    // Private mode / quota: the preference simply doesn't persist.
  }
}

export function toggleColumn(prefs: ColumnPrefs, key: WorkspaceColumnKey): ColumnPrefs {
  const col = WORKSPACE_COLUMNS.find((c) => c.key === key);
  if (!col || !col.hideable) return prefs;
  const next = prefs.visible.includes(key)
    ? prefs.visible.filter((k) => k !== key)
    : [...prefs.visible, key];
  return { ...prefs, visible: normalizeVisible(next) };
}
