import type { GlobalBanner } from '../../lib/api';

export const BANNER_TYPES = ['info', 'warning', 'critical'] as const;
export const STATUSES = ['draft', 'active', 'archived'] as const;

export const TYPE_LABELS: Record<string, string> = {
  info: 'Informativo',
  warning: 'Aviso',
  critical: 'Crítico',
};

export const STATUS_LABELS: Record<string, string> = {
  draft: 'Rascunho',
  active: 'Ativo',
  archived: 'Arquivado',
};

/** Banner type colours are data (they mirror what the CRM paints), not theme tokens. */
export const TYPE_COLORS: Record<string, { accent: string; bg: string }> = {
  info: { accent: '#42c8f5', bg: 'rgba(66,200,245,0.18)' },
  warning: { accent: '#f5a342', bg: 'rgba(245,163,66,0.22)' },
  critical: { accent: '#f55a42', bg: 'rgba(245,90,66,0.25)' },
};

export interface FormState {
  type: 'info' | 'warning' | 'critical';
  content: string;
  link: string;
  custom_color: string;
  target_mode: 'all' | 'plan' | 'workspace';
  target_plan_ids: string[];
  target_workspace_ids: string[];
  dismissible: boolean;
  starts_at: string;
  ends_at: string;
  status: 'draft' | 'active' | 'archived';
}

export const EMPTY_FORM: FormState = {
  type: 'info',
  content: '',
  link: '',
  custom_color: '',
  target_mode: 'all',
  target_plan_ids: [],
  target_workspace_ids: [],
  dismissible: true,
  starts_at: '',
  ends_at: '',
  status: 'draft',
};

export function bannerToForm(b: GlobalBanner): FormState {
  return {
    type: b.type,
    content: b.content,
    link: b.link || '',
    custom_color: b.custom_color || '',
    target_mode: b.target_mode,
    target_plan_ids: b.target_plan_ids || [],
    target_workspace_ids: b.target_workspace_ids || [],
    dismissible: b.dismissible,
    starts_at: b.starts_at ? b.starts_at.slice(0, 16) : '',
    ends_at: b.ends_at ? b.ends_at.slice(0, 16) : '',
    status: b.status,
  };
}

export function formToPayload(form: FormState): Record<string, unknown> {
  return {
    type: form.type,
    content: form.content,
    link: form.link || null,
    custom_color: form.custom_color || null,
    target_mode: form.target_mode,
    target_plan_ids: form.target_mode === 'plan' ? form.target_plan_ids : null,
    target_workspace_ids: form.target_mode === 'workspace' ? form.target_workspace_ids : null,
    dismissible: form.dismissible,
    starts_at: form.starts_at ? new Date(form.starts_at).toISOString() : null,
    ends_at: form.ends_at ? new Date(form.ends_at).toISOString() : null,
    status: form.status,
  };
}

export type BadgeTone = 'success' | 'neutral';

export function isExpired(b: GlobalBanner): boolean {
  return Boolean(b.status === 'active' && b.ends_at && new Date(b.ends_at) < new Date());
}

export function getStatusBadge(b: GlobalBanner): { label: string; tone: BadgeTone } {
  if (isExpired(b)) return { label: 'Expirado', tone: 'neutral' };
  if (b.status === 'active') return { label: 'Ativo', tone: 'success' };
  if (b.status === 'draft') return { label: 'Rascunho', tone: 'neutral' };
  return { label: 'Arquivado', tone: 'neutral' };
}

export function formatSchedule(b: GlobalBanner): string {
  const fmt = (s: string) =>
    new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  const start = b.starts_at ? fmt(b.starts_at) : 'Agora';
  const end = b.ends_at ? fmt(b.ends_at) : '∞';
  return `${start} → ${end}`;
}

export function getTargetLabel(b: GlobalBanner, plans?: { id: string; name: string }[]): string {
  if (b.target_mode === 'all') return 'Todos os workspaces';
  if (b.target_mode === 'plan') {
    const names = (b.target_plan_ids || []).map((pid) => {
      const p = plans?.find((pl) => pl.id === pid);
      return p?.name || pid;
    });
    return names.join(', ');
  }
  return `${(b.target_workspace_ids || []).length} workspaces`;
}

/** Status segments, in the order of the filter control. `value` is the server's status param. */
export const STATUS_FILTERS = [
  { value: '', label: 'Todos' },
  { value: 'active', label: 'Ativos' },
  { value: 'draft', label: 'Rascunhos' },
  { value: 'archived', label: 'Arquivo' },
] as const;
