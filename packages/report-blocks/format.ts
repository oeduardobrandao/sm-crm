import { intlLocale, reportText, type ReportLang } from './i18n';

const countFmt: Record<ReportLang, Intl.NumberFormat> = {
  pt: new Intl.NumberFormat(intlLocale('pt')),
  en: new Intl.NumberFormat(intlLocale('en')),
};

export function fmtCount(n: number, lang: ReportLang = 'pt'): string {
  return countFmt[lang].format(Math.round(n));
}

/** Uma casa decimal com o separador do idioma: "12,3" / "12.3". */
export function fmtDecimal1(n: number, lang: ReportLang = 'pt'): string {
  const s = n.toFixed(1);
  return lang === 'pt' ? s.replace('.', ',') : s;
}

export function fmtPct(n: number, lang: ReportLang = 'pt'): string {
  return `${fmtDecimal1(n, lang)}%`;
}

/** Variação com sinal: "+12,3%" / "-4.0%". */
export function fmtSignedPct(n: number, lang: ReportLang = 'pt'): string {
  return `${n >= 0 ? '+' : '-'}${fmtDecimal1(Math.abs(n), lang)}%`;
}

/** Delta percentual value vs prev; null quando não computável (prev <= 0). */
export function deltaPct(value: number, prev: number): number | null {
  if (!(prev > 0)) return null;
  return ((value - prev) / prev) * 100;
}

export const MONTHS_PT_LOWER = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

/**
 * Estampa "DD–DD de mês[ · parcial]" a partir do período real coberto do
 * snapshot (spec de paridade com o app do Instagram, §4.3). Datas do
 * snapshot são timestamps ISO à meia-noite UTC; os dias vêm sempre em UTC
 * para não deslocar com o fuso do navegador.
 *
 * Sem `effectiveEnd` (snapshot antigo, gerado antes deste campo existir)
 * retorna null -- o chamador não estampa período nenhum (mesmo guard do
 * campo `views` nos top posts).
 */
export function fmtPeriodStamp(
  period: {
    start: string;
    endExclusive: string;
    effectiveEnd?: string;
  },
  lang: ReportLang = 'pt',
): string | null {
  if (!period.effectiveEnd) return null;
  const start = new Date(period.start);
  const effectiveEnd = new Date(period.effectiveEnd);
  const lastDayOfMonthMs = Date.parse(period.endExclusive) - 86_400_000;
  const startDay = String(start.getUTCDate()).padStart(2, '0');
  const endDay = String(effectiveEnd.getUTCDate()).padStart(2, '0');
  const text = reportText(lang);
  const range = text.dayRange(startDay, endDay, effectiveEnd.getUTCMonth() + 1);
  return effectiveEnd.getTime() >= lastDayOfMonthMs ? range : `${range} · ${text.partial}`;
}

/** Link externo seguro para href: só https, sem credenciais; qualquer outra coisa vira null
 * (o chamador não renderiza o link). O pacote não depende do sanitizeUrl do CRM. */
export function safeHttpsUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
    return parsed.href;
  } catch {
    return null;
  }
}
