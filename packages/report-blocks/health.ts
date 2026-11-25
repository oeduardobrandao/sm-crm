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
export function verdictFor(pct: number): Verdict {
  if (pct >= 80) return { label: 'Muito bom', tone: 'great' };
  if (pct >= 60) return { label: 'Bom', tone: 'good' };
  if (pct >= 40) return { label: 'Na média', tone: 'avg' };
  if (pct >= 20) return { label: 'Ruim', tone: 'bad' };
  return { label: 'Muito ruim', tone: 'worst' };
}

/** Média simples dos percentis presentes, arredondada. `null` quando não há nenhum. */
export function overallPercentile(pcts: number[]): number | null {
  if (pcts.length === 0) return null;
  const sum = pcts.reduce((acc, p) => acc + p, 0);
  return Math.round(sum / pcts.length);
}

const BAND_LABELS: Record<FollowerBand, string> = {
  lt1k: 'com menos de 1 mil seguidores',
  '1k_5k': 'de 1 mil a 5 mil seguidores',
  '5k_20k': 'de 5 mil a 20 mil seguidores',
  '20k_100k': 'de 20 mil a 100 mil seguidores',
  '100k_plus': 'com mais de 100 mil seguidores',
};

export function bandLabel(band: FollowerBand): string {
  return BAND_LABELS[band];
}

/**
 * Tamanho do grupo para exibir ("mais de 300"): maior múltiplo de 100 estritamente
 * menor que n quando n > 100, senão maior múltiplo de 10 estritamente menor que n.
 */
export function roundedSampleLabel(n: number): string {
  const step = n > 100 ? 100 : 10;
  const floored = Math.floor((n - 1) / step) * step;
  return `mais de ${floored}`;
}

const pctFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const pctIntFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  maximumFractionDigits: 0,
});
const intFormatter = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

/** Formata uma métrica para exibição em pt-BR. `engagement_rate` e `reels_share` são frações (0,0193 = 1,93%). */
export function formatMetric(key: HealthMetricKey, v: number): string {
  switch (key) {
    case 'engagement_rate':
      return pctFormatter.format(v);
    case 'reels_share':
      return pctIntFormatter.format(v);
    case 'posts_30d':
    case 'reel_views':
      return intFormatter.format(v);
  }
}
