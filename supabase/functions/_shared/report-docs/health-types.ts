// Tipos da saúde do Instagram (cartão da Analytics da conta e bloco `account_health` do relatório).
// Só tipos, sem runtime: importado pelo Deno (report-docs) e pelo frontend (packages/report-blocks),
// mesmo padrão de snapshot.ts. Spec: docs/superpowers/specs/2026-11-25-ig-account-health-report-block-design.md

export type HealthMetricKey = "engagement_rate" | "posts_30d" | "reel_views" | "reels_share";
export type FollowerBand = "lt1k" | "1k_5k" | "5k_20k" | "20k_100k" | "100k_plus";
export type BenchmarkSource = "mercado" | "mesaas";

export interface PeerBenchmark {
  metric: HealthMetricKey;
  source: BenchmarkSource;
  sample_size: number | null;
  /** 99 cortes, p1..p99, não decrescentes. */
  cuts: number[];
}

/** `data_snapshot.instagram_health`: métricas no corte do relatório, congeladas na geração. */
export interface InstagramHealthSnapshot {
  /** ISO do corte: min(period.endExclusive, instante da geração). */
  as_of: string;
  /** Seguidores no corte (histórico) ou atuais; denominador do engajamento e base da faixa. */
  followers: number;
  band: FollowerBand | null;
  metrics: Record<HealthMetricKey, number | null>;
  /** Referências vigentes na geração, por métrica; métrica sem referência fica de fora. */
  benchmarks: Partial<Record<HealthMetricKey, PeerBenchmark>>;
  /** thumbnail_url só se for URL estável (cache); nunca URL efêmera do CDN. */
  best_post: { ratio: number; permalink: string | null; thumbnail_url: string | null } | null;
}
