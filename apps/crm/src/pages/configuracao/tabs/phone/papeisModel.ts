import {
  AGENT_ROLE_PRESET,
  PERMISSION_MODULES,
  type PermissionLevel,
  type PermissionModule,
} from '@/lib/permissions';

/**
 * Labels, groups, presets and helpers of the Papéis tab, shared by the desktop list +
 * Dialog (PapeisTab) and the phone screens (PapeisPhone), so both read the same copy
 * and the same permission rules.
 */

export const MODULE_LABELS: Record<PermissionModule, string> = {
  clientes: 'Clientes',
  entregas: 'Entregas',
  calendario: 'Calendário',
  aprovacoes: 'Aprovações',
  arquivos: 'Arquivos',
  ideias: 'Ideias',
  tarefas: 'Tarefas',
  leads: 'Leads',
  financeiro: 'Financeiro',
  contratos: 'Contratos',
  equipe: 'Equipe',
  analytics: 'Analytics e Relatórios',
  automacoes: 'Automações',
  configuracoes: 'Configurações do workspace',
};

/** Group headers reused as-is for the list's expanded chip rows (Pode editar /
 * Pode ver / Sem acesso, in that order — see PermissionChipGroups). */
export const LEVEL_LABELS: Record<PermissionLevel, string> = {
  none: 'Sem acesso',
  ver: 'Pode ver',
  editar: 'Pode editar',
};

/** Short labels for the form's 3-state segmented control (variant 1 of the
 * approved mockup drops the "Pode" prefix on Ver/Editar to fit the pill). */
export const LEVEL_SEGMENT_LABELS: Record<PermissionLevel, string> = {
  none: 'Sem acesso',
  ver: 'Ver',
  editar: 'Editar',
};

/** Order of the segments in the level control (desktop ToggleGroup and phone). */
export const LEVEL_ORDER: PermissionLevel[] = ['none', 'ver', 'editar'];

/** Grouped single-column sections for the edit/create form (papeis-form-edicao,
 * variant 1 — "Lista única, agrupada por área"). Order matches the mockup. */
export const MODULE_GROUPS: { label: string; modules: PermissionModule[] }[] = [
  {
    label: 'Trabalho',
    modules: ['entregas', 'calendario', 'aprovacoes', 'ideias', 'tarefas', 'arquivos'],
  },
  { label: 'Clientes e análise', modules: ['clientes', 'analytics', 'leads'] },
  {
    label: 'Gestão',
    modules: ['financeiro', 'contratos', 'equipe', 'automacoes', 'configuracoes'],
  },
];

/** Modules whose permission is enforced server-side (RLS / RPC), shown with the
 * "servidor" tag in the form per the mockup — the rest are CRM-UI-only gates. */
export const SERVER_ENFORCED_MODULES = new Set<PermissionModule>([
  'leads',
  'financeiro',
  'contratos',
  'equipe',
  'automacoes',
  'configuracoes',
]);

export type RolePermissions = Record<PermissionModule, PermissionLevel>;

function buildPermissions(level: PermissionLevel): RolePermissions {
  return PERMISSION_MODULES.reduce((acc, mod) => {
    acc[mod] = level;
    return acc;
  }, {} as RolePermissions);
}

export const ADMIN_PERMISSIONS: RolePermissions = buildPermissions('editar');
export const BLANK_PERMISSIONS: RolePermissions = buildPermissions('none');

export type PresetChoice = 'administrador' | 'agente' | 'em_branco';

export const PRESET_ORDER: PresetChoice[] = ['agente', 'administrador', 'em_branco'];
export const PRESET_LABELS: Record<PresetChoice, string> = {
  agente: 'Agente',
  administrador: 'Administrador',
  em_branco: 'Em branco',
};

export function presetPermissions(preset: PresetChoice): RolePermissions {
  if (preset === 'administrador') return { ...ADMIN_PERMISSIONS };
  if (preset === 'agente') return { ...AGENT_ROLE_PRESET };
  return { ...BLANK_PERMISSIONS };
}

/** Merges a stored (possibly partial/legacy-shaped) permissions jsonb onto the full module set. */
export function normalizePermissions(
  raw: Record<string, string> | null | undefined,
): RolePermissions {
  const merged = { ...BLANK_PERMISSIONS };
  for (const mod of PERMISSION_MODULES) {
    const value = raw?.[mod];
    if (value === 'none' || value === 'ver' || value === 'editar') merged[mod] = value;
  }
  return merged;
}

/** "N editar · N ver · N sem acesso", omitting any segment with a zero count
 * (a role with no "ver" modules never shows "0 ver"). Used for every role's
 * one-line summary except Administrador, which has a fixed override string. */
export function summarizePermissions(permissions: RolePermissions): string {
  let editar = 0;
  let ver = 0;
  let none = 0;
  for (const mod of PERMISSION_MODULES) {
    const level = permissions[mod];
    if (level === 'editar') editar += 1;
    else if (level === 'ver') ver += 1;
    else none += 1;
  }
  const parts: string[] = [];
  if (editar > 0) parts.push(`${editar} editar`);
  if (ver > 0) parts.push(`${ver} ver`);
  if (none > 0) parts.push(`${none} sem acesso`);
  return parts.join(' · ');
}

/** Fixed summary for Administrador — real Financeiro access varies per admin
 * (their own "Ver financeiro" switch on the Equipe tab), so a computed count
 * would be misleading; the mockup calls this out explicitly instead. */
export const ADMIN_SUMMARY = 'Edita tudo · Financeiro conforme o acesso de cada admin';

export interface RoleFormState {
  roleId: string | null;
  nome: string;
  permissions: RolePermissions;
  preset: PresetChoice;
}

/** Text override for one module's chip, e.g. the Administrador card's
 * Financeiro chip (real access varies per admin, not a fixed level). */
export type PermissionOverrides = Partial<Record<PermissionModule, string>>;

/** Financeiro access for a restricted admin depends on that member's own "Ver
 * financeiro" switch (Equipe tab) — never a fixed level, so the read-only
 * Administrador card must not claim one. */
export const ADMIN_PERMISSION_OVERRIDES: PermissionOverrides = {
  financeiro: 'Conforme o acesso financeiro de cada admin',
};

export function memberCountLabel(count: number): string {
  return count === 1 ? '1 membro' : `${count} membros`;
}
