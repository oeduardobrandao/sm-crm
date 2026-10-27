import { i18n } from '@mesaas/i18n';
import {
  AGENT_ROLE_PRESET,
  PERMISSION_MODULES,
  type PermissionLevel,
  type PermissionModule,
} from '@/lib/permissions';

/**
 * Labels, groups, presets and helpers of the Papéis tab, shared by the desktop list +
 * Dialog (PapeisTab) and the phone screens (PapeisPhone), so both read the same copy
 * and the same permission rules. Every label is resolved at call time (`i18n.t`), so it
 * follows the UI language.
 */

/** Module name. Every module but two is named as in the CRM nav (`common:nav.*`). */
export function moduleLabel(mod: PermissionModule): string {
  switch (mod) {
    case 'clientes':
      return i18n.t('nav.clientes');
    case 'entregas':
      return i18n.t('nav.entregas');
    case 'calendario':
      return i18n.t('nav.calendario');
    case 'aprovacoes':
      return i18n.t('nav.aprovacoes');
    case 'arquivos':
      return i18n.t('nav.arquivos');
    case 'ideias':
      return i18n.t('nav.ideias');
    case 'tarefas':
      return i18n.t('nav.tarefas');
    case 'leads':
      return i18n.t('nav.leads');
    case 'financeiro':
      return i18n.t('nav.financeiro');
    case 'contratos':
      return i18n.t('nav.contratos');
    case 'equipe':
      return i18n.t('nav.equipe');
    case 'analytics':
      return i18n.t('settings:papeis.modules.analytics');
    case 'automacoes':
      return i18n.t('nav.automacoes');
    case 'configuracoes':
      return i18n.t('settings:papeis.modules.configuracoes');
  }
}

/** Group headers reused as-is for the list's expanded chip rows (Pode editar /
 * Pode ver / Sem acesso, in that order — see PermissionChipGroups). */
export function levelLabel(level: PermissionLevel): string {
  return i18n.t(`settings:papeis.levels.${level}`);
}

/** Short labels for the form's 3-state segmented control (variant 1 of the
 * approved mockup drops the "Pode" prefix on Ver/Editar to fit the pill). */
export function levelSegmentLabel(level: PermissionLevel): string {
  return i18n.t(`settings:papeis.segments.${level}`);
}

/** Order of the segments in the level control (desktop ToggleGroup and phone). */
export const LEVEL_ORDER: PermissionLevel[] = ['none', 'ver', 'editar'];

/** Grouped single-column sections for the edit/create form (papeis-form-edicao,
 * variant 1 — "Lista única, agrupada por área"). Order matches the mockup. */
export type ModuleGroupKey = 'trabalho' | 'clientes' | 'gestao';

export const MODULE_GROUPS: { key: ModuleGroupKey; modules: PermissionModule[] }[] = [
  {
    key: 'trabalho',
    modules: ['entregas', 'calendario', 'aprovacoes', 'ideias', 'tarefas', 'arquivos'],
  },
  { key: 'clientes', modules: ['clientes', 'analytics', 'leads'] },
  {
    key: 'gestao',
    modules: ['financeiro', 'contratos', 'equipe', 'automacoes', 'configuracoes'],
  },
];

/** Header of a MODULE_GROUPS section. */
export function moduleGroupLabel(key: ModuleGroupKey): string {
  if (key === 'gestao') return i18n.t('nav.gestao');
  return i18n.t(`settings:papeis.groups.${key}`);
}

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
export function presetLabel(preset: PresetChoice): string {
  return i18n.t(`settings:papeis.presets.${preset}`);
}

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
  if (editar > 0) parts.push(i18n.t('settings:papeis.summary.editar', { n: editar }));
  if (ver > 0) parts.push(i18n.t('settings:papeis.summary.ver', { n: ver }));
  if (none > 0) parts.push(i18n.t('settings:papeis.summary.none', { n: none }));
  return parts.join(' · ');
}

/** Fixed summary for Administrador — real Financeiro access varies per admin
 * (their own "Ver financeiro" switch on the Equipe tab), so a computed count
 * would be misleading; the mockup calls this out explicitly instead. */
export function adminSummary(): string {
  return i18n.t('settings:papeis.adminSummary');
}

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
export function adminPermissionOverrides(): PermissionOverrides {
  return { financeiro: i18n.t('settings:papeis.adminFinanceOverride') };
}

/** "1 membro" / "N membros" (0 included). */
export function memberCountLabel(count: number): string {
  return i18n.t('settings:papeis.members', { count });
}
