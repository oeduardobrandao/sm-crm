/**
 * Lógica pura do cartão "Saúde do Instagram": percentis contra contas do mesmo
 * tamanho, vereditos, rótulos de faixa e formatação das métricas.
 * Sem React e sem acesso a dados; o servidor entrega os cortes e a faixa.
 * Compartilhada entre o CRM (cartão da Analytics) e o bloco do relatório.
 */
import type {
  BenchmarkSource,
  FollowerBand,
  HealthMetricKey,
  InstagramHealthSnapshot,
  PeerBenchmark,
} from '../../supabase/functions/_shared/report-docs/health-types';
import { intlLocale, reportText, type ReportLang } from './i18n';

export type {
  BenchmarkSource,
  FollowerBand,
  HealthMetricKey,
  InstagramHealthSnapshot,
  PeerBenchmark,
};

export type VerdictTone = 'great' | 'good' | 'avg' | 'bad' | 'worst';

export interface Verdict {
  label: string;
  tone: VerdictTone;
}

const CUT_COUNT = 99;

/**
 * Percentil (0..100, inteiro) de `value` frente aos 99 cortes p1..p99 (cuts[i] = p(i+1)).
 * Empates usam o posto médio: com `eq > 0`, pct = lt + eq/2 + 0.5. Sem empate,
 * interpola linearmente entre os cortes vizinhos; abaixo de p1 vai de 0 a 1 e acima
 * de p99 vira 100.
 */
export function percentileFromCuts(value: number, cuts: number[]): number {
  if (cuts.length === 0) return 50;

  let lt = 0;
  let eq = 0;
  for (const c of cuts) {
    if (c < value) lt++;
    else if (c === value) eq++;
  }

  let pct: number;
  if (eq > 0) {
    pct = lt + eq / 2 + 0.5;
  } else if (lt === 0) {
    pct = cuts[0] > 0 ? value / cuts[0] : 0;
  } else if (lt >= CUT_COUNT) {
    pct = 100;
  } else {
    const below = cuts[lt - 1];
    const above = cuts[lt];
    pct = lt + (value - below) / (above - below);
  }

  return Math.min(100, Math.max(0, Math.round(pct)));
}

/** Veredito pelo percentil: >=80 Muito bom, >=60 Bom, >=40 Na média, >=20 Ruim, senão Muito ruim. */
export function verdictFor(pct: number, lang: ReportLang = 'pt'): Verdict {
  const tone: VerdictTone =
    pct >= 80 ? 'great' : pct >= 60 ? 'good' : pct >= 40 ? 'avg' : pct >= 20 ? 'bad' : 'worst';
  return { label: reportText(lang).health.verdict[tone], tone };
}

/** Média simples dos percentis presentes, arredondada. `null` quando não há nenhum. */
export function overallPercentile(pcts: number[]): number | null {
  if (pcts.length === 0) return null;
  const sum = pcts.reduce((acc, p) => acc + p, 0);
  return Math.round(sum / pcts.length);
}

export function bandLabel(band: FollowerBand, lang: ReportLang = 'pt'): string {
  return reportText(lang).health.bands[band];
}

/**
 * Tamanho do grupo para exibir ("mais de 300"): maior múltiplo de 100 estritamente
 * menor que n quando n > 100, senão maior múltiplo de 10 estritamente menor que n.
 */
export function roundedSampleLabel(n: number, lang: ReportLang = 'pt'): string {
  const step = n > 100 ? 100 : 10;
  const floored = Math.floor((n - 1) / step) * step;
  return reportText(lang).health.sample(floored);
}

function metricFormatters(lang: ReportLang) {
  const locale = intlLocale(lang);
  return {
    pct: new Intl.NumberFormat(locale, {
      style: 'percent',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
    pctInt: new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }),
    int: new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }),
  };
}
const FORMATTERS: Record<ReportLang, ReturnType<typeof metricFormatters>> = {
  pt: metricFormatters('pt'),
  en: metricFormatters('en'),
};

/** Formata uma métrica no idioma (pt-BR padrão). `engagement_rate` e `reels_share` são frações (0,0193 = 1,93%). */
export function formatMetric(key: HealthMetricKey, v: number, lang: ReportLang = 'pt'): string {
  const f = FORMATTERS[lang];
  switch (key) {
    case 'engagement_rate':
      return f.pct.format(v);
    case 'reels_share':
      return f.pctInt.format(v);
    case 'posts_30d':
    case 'reel_views':
      return f.int.format(v);
  }
}

/** Ordem fixa das métricas no cartão e no bloco. */
export const HEALTH_METRIC_ORDER: readonly HealthMetricKey[] = [
  'engagement_rate',
  'posts_30d',
  'reel_views',
  'reels_share',
];

export const HEALTH_METRIC_TITLES: Record<HealthMetricKey, string> =
  reportText('pt').health.metricTitles;

/** Motivo exibido quando a métrica vem nula (posts_30d nunca é nula na prática). */
export const HEALTH_NULL_REASONS: Record<HealthMetricKey, string | null> =
  reportText('pt').health.nullReasons;

/** Linha de destaque da métrica de maior percentil (v = você, p = mediana das contas do tamanho). */
export function highlightLine(
  key: HealthMetricKey,
  v: string,
  p: string,
  lang: ReportLang = 'pt',
): string {
  return reportText(lang).health.highlight[key](v, p);
}

export interface ScoredHealthMetric {
  key: HealthMetricKey;
  value: number;
  benchmark: PeerBenchmark;
  pct: number;
}

/** Métricas com valor e referência válida (exatamente 99 cortes), na ordem fixa, com o percentil. */
export function scoreHealthMetrics(
  metrics: Record<HealthMetricKey, number | null>,
  benchmarks: Partial<Record<HealthMetricKey, PeerBenchmark>>,
): ScoredHealthMetric[] {
  const scored: ScoredHealthMetric[] = [];
  for (const key of HEALTH_METRIC_ORDER) {
    const value = metrics[key];
    const benchmark = benchmarks[key];
    // Benchmark malformado (diferente de 99 cortes) conta como sem referência.
    // cuts fora de array (JSON malformado no snapshot) também; nunca lança.
    if (value == null || !Array.isArray(benchmark?.cuts) || benchmark.cuts.length !== CUT_COUNT)
      continue;
    scored.push({ key, value, benchmark, pct: percentileFromCuts(value, benchmark.cuts) });
  }
  return scored;
}

/**
 * `data_snapshot.instagram_health` (campo opcional; snapshot antigo não o tem). Lido de forma
 * estrutural para o pacote não depender de a chave já existir em `ReportDocSnapshot`.
 */
export function readInstagramHealth(snapshot: object): InstagramHealthSnapshot | null {
  const h = (snapshot as { instagram_health?: InstagramHealthSnapshot | null }).instagram_health;
  return h && typeof h === 'object' ? h : null;
}

/** O bloco do relatório tem o que mostrar: seguidores, faixa e ao menos uma métrica comparável. */
export function healthHasData(h: InstagramHealthSnapshot | null): h is InstagramHealthSnapshot {
  if (!h || !h.band || !(h.followers > 0) || !h.metrics || !h.benchmarks) return false;
  return scoreHealthMetrics(h.metrics, h.benchmarks).length > 0;
}
