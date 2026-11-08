import { EMAIL_CATEGORY_LABELS, presetRange, validateCustomRange } from './email-metrics-view';

export type StatusGroup =
  | 'entregue'
  | 'atrasado'
  | 'pendente'
  | 'bounce'
  | 'reclamacao'
  | 'nao_enviado';

export type BadgeTone = 'success' | 'warning' | 'neutral' | 'danger';

export const STATUS_GROUPS: {
  key: StatusGroup;
  label: string;
  events: string[];
  badge: BadgeTone;
}[] = [
  { key: 'entregue', label: 'Entregue', events: ['delivered'], badge: 'success' },
  { key: 'atrasado', label: 'Atrasado', events: ['delivery_delayed'], badge: 'warning' },
  { key: 'pendente', label: 'Pendente', events: ['sent'], badge: 'neutral' },
  { key: 'bounce', label: 'Bounce', events: ['bounced'], badge: 'danger' },
  { key: 'reclamacao', label: 'Reclamação', events: ['complained'], badge: 'danger' },
  {
    key: 'nao_enviado',
    label: 'Não enviado',
    events: ['failed', 'suppressed', 'canceled'],
    badge: 'neutral',
  },
];

export function statusGroupOf(event: string): StatusGroup {
  return STATUS_GROUPS.find((g) => g.events.includes(event))?.key ?? 'pendente';
}

export const NOT_SENT_DETAIL: Record<string, string> = {
  failed: 'Falha no envio',
  suppressed: 'Suprimido',
  canceled: 'Cancelado',
};

export type ListPreset = '7d' | '30d' | '90d' | 'custom';

export interface ListFilters {
  preset: ListPreset;
  start: string;
  end: string;
  categories: string[];
  types: string[];
  statuses: StatusGroup[];
}

const PRESETS = ['7d', '30d', '90d'] as const;
const TYPE_RE = /^[a-z0-9_]{1,64}$/;

function csv(sp: URLSearchParams, key: string): string[] {
  const raw = sp.get(key);
  return raw ? raw.split(',').filter(Boolean) : [];
}

/** URL to filters. Any invalid preset or date falls back to the last 7 days. */
export function parseListSearch(sp: URLSearchParams, today: Date): ListFilters {
  const rawPreset = sp.get('preset');
  let preset: ListPreset = '7d';
  let range = presetRange('7d', today);
  if ((PRESETS as readonly string[]).includes(rawPreset ?? '')) {
    preset = rawPreset as '7d' | '30d' | '90d';
    range = presetRange(preset, today);
  } else if (rawPreset === 'custom') {
    const start = sp.get('start') ?? '';
    const end = sp.get('end') ?? '';
    if (validateCustomRange(start, end) === null) {
      preset = 'custom';
      range = { start, end };
    }
  }
  const dedupe = <T>(a: T[]) => [...new Set(a)];
  return {
    preset,
    ...range,
    categories: dedupe(csv(sp, 'cat').filter((c) => c in EMAIL_CATEGORY_LABELS)),
    types: dedupe(csv(sp, 'type').filter((t) => TYPE_RE.test(t))),
    statuses: dedupe(
      csv(sp, 'status').filter((s): s is StatusGroup => STATUS_GROUPS.some((g) => g.key === s)),
    ),
  };
}

export function listFiltersToSearch(f: ListFilters): URLSearchParams {
  const sp = new URLSearchParams();
  sp.set('preset', f.preset);
  if (f.preset === 'custom') {
    sp.set('start', f.start);
    sp.set('end', f.end);
  }
  if (f.categories.length) sp.set('cat', f.categories.join(','));
  if (f.types.length) sp.set('type', f.types.join(','));
  if (f.statuses.length) sp.set('status', f.statuses.join(','));
  return sp;
}

/** Expands the selected status groups into `last_event` values. */
export function statusesToEvents(statuses: StatusGroup[]): string[] {
  return STATUS_GROUPS.filter((g) => statuses.includes(g.key)).flatMap((g) => g.events);
}

export function resendEmailUrl(id: string): string {
  return 'https://resend.com/emails/' + encodeURIComponent(id);
}

const SP_DATE_TIME = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** 'DD/MM/AAAA HH:mm' in São Paulo. Empty string on unparseable input; never throws. */
export function formatSpDateTime(iso: string): string {
  try {
    const t = new Date(iso.replace(' ', 'T'));
    if (Number.isNaN(t.getTime())) return '';
    const p = Object.fromEntries(SP_DATE_TIME.formatToParts(t).map((x) => [x.type, x.value]));
    return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
  } catch {
    return '';
  }
}
