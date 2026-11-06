import type {
  EmailCounts,
  EmailMetricsDaily,
  EmailMetricsRecent,
  EmailMetricsResponse,
} from '../../lib/api';

export type Counts = EmailCounts;

export const EMAIL_CATEGORY_LABELS: Record<string, string> = {
  notificacoes: 'Notificações',
  ciclo_de_vida: 'Ciclo de vida',
  convites: 'Convites',
  cobranca: 'Cobrança',
  relatorios: 'Relatórios',
  afiliados: 'Afiliados',
  interno: 'Interno',
  externo: 'Externo',
  outros: 'Outros',
};

export const EMAIL_TYPE_LABELS: Record<string, string> = {
  notification_digest: 'Resumo de notificações',
  client_event: 'Avisos ao cliente',
  agenda_lembrete: 'Lembretes da agenda',
  agenda_cliente: 'Convites da agenda',
  welcome: 'Boas-vindas',
  thank_you: 'Agradecimento de assinatura',
  trial_reminder: 'Fim do teste',
  nurture_a1: 'Nurture A1',
  nurture_a2: 'Nurture A2',
  nurture_a3: 'Nurture A3',
  nurture_a3_b1: 'Nurture A3 ou B1',
  nurture_a4: 'Nurture A4',
  nurture_b1: 'Nurture B1',
  nurture_b2: 'Nurture B2',
  nurture_b3: 'Nurture B3',
  nurture_b4: 'Nurture B4',
  nurture_a4_b4: 'Nurture A4 ou B4',
  instagram_connect: 'Link de conexão do Instagram',
  instagram_connected: 'Instagram conectado',
  invite: 'Convite de equipe',
  demo_access: 'Acesso demo',
  dunning: 'Cobrança pendente',
  report: 'Relatório mensal',
  affiliate_link: 'Link de afiliado',
  founder_signup: 'Aviso de cadastro',
  founder_subscription: 'Aviso de assinatura',
  cron_failure: 'Falha de rotina',
  retention_radar: 'Radar de retenção',
  alerta_interno: 'Alerta interno',
  desconhecido: 'Não identificado',
  notificacao: 'Notificação',
};

export const BOUNCE_ALERT = 0.04;
export const COMPLAINT_ALERT = 0.0008;

/** Categories excluded from KPIs, chart and bounce list. */
const EXCLUDED_CATEGORIES = ['interno', 'externo'];

/** Longest allowed custom range: 365 days apart (366 days inclusive). */
export const MAX_RANGE_DAYS = 365;

export function typeLabel(t: string): string {
  return EMAIL_TYPE_LABELS[t] ?? t;
}

export function categoryLabel(c: string): string {
  return EMAIL_CATEGORY_LABELS[c] ?? c;
}

export interface Rates {
  delivery: number | null;
  bounce: number | null;
  complaint: number | null;
}

export function rates(c: Counts): Rates {
  const reached = c.delivered + c.complained;
  return {
    delivery: c.sent > 0 ? reached / c.sent : null,
    bounce: c.sent > 0 ? c.bounced / c.sent : null,
    complaint: reached > 0 ? c.complained / reached : null,
  };
}

export function formatRate(r: number | null): string {
  if (r === null) return 'Sem envios';
  const pct = r * 100;
  const digits = pct < 1 ? 2 : 1;
  return `${pct.toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}

const ZERO: Counts = {
  sent: 0,
  delivered: 0,
  bounced: 0,
  complained: 0,
  delayed: 0,
  pending: 0,
  not_sent: 0,
};

function addCounts(a: Counts, b: Counts): Counts {
  return {
    sent: a.sent + b.sent,
    delivered: a.delivered + b.delivered,
    bounced: a.bounced + b.bounced,
    complained: a.complained + b.complained,
    delayed: a.delayed + b.delayed,
    pending: a.pending + b.pending,
    not_sent: a.not_sent + b.not_sent,
  };
}

function pickCounts(r: Counts): Counts {
  return {
    sent: r.sent,
    delivered: r.delivered,
    bounced: r.bounced,
    complained: r.complained,
    delayed: r.delayed,
    pending: r.pending,
    not_sent: r.not_sent,
  };
}

export interface TypeRow {
  type: string;
  label: string;
  counts: Counts;
  rates: Rates;
}

export interface CategoryRow {
  category: string;
  label: string;
  counts: Counts;
  rates: Rates;
  types: TypeRow[];
}

export interface EmailView {
  kpis: Counts & Rates;
  categories: CategoryRow[];
  excluded: CategoryRow[];
  daily: EmailMetricsDaily[];
  recent: EmailMetricsRecent[];
  coverageStart: string | null;
}

function groupCategories(rows: EmailMetricsResponse['by_type']): CategoryRow[] {
  const map = new Map<string, CategoryRow>();
  for (const r of rows) {
    let cat = map.get(r.category);
    if (!cat) {
      cat = {
        category: r.category,
        label: categoryLabel(r.category),
        counts: { ...ZERO },
        rates: rates(ZERO),
        types: [],
      };
      map.set(r.category, cat);
    }
    const counts = pickCounts(r);
    cat.counts = addCounts(cat.counts, counts);
    cat.types.push({ type: r.type, label: typeLabel(r.type), counts, rates: rates(counts) });
  }
  const out = [...map.values()];
  for (const cat of out) {
    cat.rates = rates(cat.counts);
    cat.types.sort((a, b) => b.counts.sent - a.counts.sent);
  }
  return out.sort((a, b) => b.counts.sent - a.counts.sent);
}

export function buildEmailView(res: EmailMetricsResponse): EmailView {
  const all = groupCategories(res.by_type);
  const categories = all.filter((c) => !EXCLUDED_CATEGORIES.includes(c.category));
  const excluded = all.filter((c) => EXCLUDED_CATEGORIES.includes(c.category));
  const total = categories.reduce((acc, c) => addCounts(acc, c.counts), { ...ZERO });
  return {
    kpis: { ...total, ...rates(total) },
    categories,
    excluded,
    daily: res.daily,
    recent: res.recent,
    coverageStart: res.coverage_start,
  };
}

const SP_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Sao_Paulo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** YYYY-MM-DD of the given instant in America/Sao_Paulo. */
export function saoPauloDate(d: Date): string {
  return SP_DATE.format(d);
}

function shiftDay(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function presetRange(
  preset: '7d' | '30d' | '90d',
  today: Date,
): { start: string; end: string } {
  const days = preset === '7d' ? 7 : preset === '30d' ? 30 : 90;
  const end = saoPauloDate(today);
  return { start: shiftDay(end, -(days - 1)), end };
}

/** Returns a Portuguese error message, or null when the custom range is valid. */
export function validateCustomRange(start: string, end: string): string | null {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(start) || !re.test(end)) return 'Informe as duas datas.';
  if (start > end) return 'A data inicial não pode ser depois da final.';
  const diff = (Date.parse(end) - Date.parse(start)) / 86_400_000;
  if (diff > MAX_RANGE_DAYS) return 'O período máximo é de 365 dias.';
  return null;
}
