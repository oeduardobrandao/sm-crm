import { escapeHtml } from "./escape.ts";
import type { ReportData, Recommendation } from "./types.ts";

/**
 * Formats a number using pt-BR locale conventions:
 * dot as thousands separator, comma as decimal separator.
 */
function fmtNumber(value: number, decimals = 0): string {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Formats a delta percentage with sign, using pt-BR locale (comma decimal).
 * Returns empty string if delta is nullish.
 */
function fmtDelta(delta: number | undefined): string {
  if (delta === undefined || delta === null) return "";
  const sign = delta >= 0 ? "+" : "";
  return ` (${sign}${fmtNumber(delta, 1)}%)`;
}

/**
 * Builds a bullet-point HTML summary of the report period.
 * Numbers are formatted with pt-BR locale (dot for thousands, comma for decimals).
 * All user-supplied strings are passed through escapeHtml.
 */
export function buildFallbackSummary(data: ReportData): string {
  const { kpis, kpi_deltas } = data;

  const followersGained = kpis["followers_gained"]?.value ?? 0;
  const reach = kpis["reach"]?.value ?? 0;
  const engagementRate = kpis["engagement_rate"]?.value ?? 0;
  const postsCount = kpis["posts_count"]?.value ?? 0;

  const followersDelta = fmtDelta(kpi_deltas.followers_pct_change);
  const reachDelta = fmtDelta(kpi_deltas.reach_pct_change);
  const engagementDelta = fmtDelta(kpi_deltas.engagement_pct_change);

  const followersStr = escapeHtml(fmtNumber(followersGained));
  const reachStr = escapeHtml(fmtNumber(reach));
  const engagementStr = escapeHtml(fmtNumber(engagementRate, 1));
  const postsStr = escapeHtml(fmtNumber(postsCount));

  return `<ul>
  <li><strong>Novos seguidores:</strong> ${followersStr}${escapeHtml(followersDelta)}</li>
  <li><strong>Alcance total:</strong> ${reachStr}${escapeHtml(reachDelta)}</li>
  <li><strong>Taxa de engajamento:</strong> ${engagementStr}%${escapeHtml(engagementDelta)}</li>
  <li><strong>Publicações:</strong> ${postsStr}</li>
</ul>`;
}

/**
 * Builds 3-5 rule-based recommendations from the report data.
 * Rules (in priority order):
 * 1. If Reels have higher avg_engagement than other content types → recommend more Reels (high)
 * 2. If engagement delta is negative → recommend reviewing content strategy (high)
 * 3. If saves are relatively high (saves > reach * 0.03) → recommend more saveable content (medium)
 * 4. If post frequency is low (< 12 posts) → recommend increasing frequency (medium)
 * 5. If follower growth is positive → recommend maintaining momentum (low)
 */
export function buildFallbackRecommendations(data: ReportData): Recommendation[] {
  const recs: Recommendation[] = [];
  const { kpis, kpi_deltas, content_breakdown } = data;

  const postsCount = kpis["posts_count"]?.value ?? 0;
  const reach = kpis["reach"]?.value ?? 0;
  const saves = kpis["saves"]?.value ?? 0;
  const followersGained = kpis["followers_gained"]?.value ?? 0;

  // Rule 1: Reels outperform other content types
  const reelEngagement = content_breakdown.reels?.avg_engagement ?? 0;
  const carouselEngagement = content_breakdown.carousels?.avg_engagement ?? 0;
  const imageEngagement = content_breakdown.images?.avg_engagement ?? 0;
  const otherMax = Math.max(carouselEngagement, imageEngagement);
  if (reelEngagement > 0 && reelEngagement > otherMax) {
    recs.push({
      title: "Priorize a produção de Reels",
      description:
        "Os Reels estão gerando maior engajamento médio em comparação a outros formatos. " +
        "Aumentar a frequência de Reels pode amplificar o alcance e as interações do perfil.",
      priority: "high",
      based_on_metric: "engagement_rate",
    });
  }

  // Rule 2: Engagement is declining
  if (
    kpi_deltas.engagement_pct_change !== undefined &&
    kpi_deltas.engagement_pct_change < 0
  ) {
    recs.push({
      title: "Revise a estratégia de conteúdo",
      description:
        "A taxa de engajamento apresentou queda em relação ao período anterior. " +
        "Avalie os temas, formatos e horários de publicação para identificar oportunidades de melhoria.",
      priority: "high",
      based_on_metric: "engagement_rate",
    });
  }

  // Rule 3: High saves rate (saves > 3% of reach)
  if (reach > 0 && saves / reach > 0.03) {
    recs.push({
      title: "Aposte em conteúdo educativo e salvável",
      description:
        "O volume de salvamentos indica que o público valoriza conteúdos informativos e práticos. " +
        "Produza mais materiais do tipo 'guia', 'passo a passo' ou 'lista de dicas' para maximizar salvamentos.",
      priority: "medium",
      based_on_metric: "saves",
    });
  }

  // Rule 4: Low posting frequency
  if (postsCount < 12) {
    recs.push({
      title: "Aumente a frequência de publicações",
      description:
        `Foram publicados ${postsCount} posts neste período, abaixo do ideal de pelo menos 12 por mês. ` +
        "Maior consistência nas publicações contribui para o crescimento orgânico e a fidelização da audiência.",
      priority: "medium",
      based_on_metric: "posts_count",
    });
  }

  // Rule 5: Positive follower growth
  if (followersGained > 0) {
    recs.push({
      title: "Mantenha o ritmo de crescimento",
      description:
        "O perfil registrou crescimento positivo de seguidores neste período. " +
        "Manter a consistência de conteúdo e o engajamento com a comunidade é fundamental para sustentar essa tendência.",
      priority: "low",
      based_on_metric: "followers_gained",
    });
  }

  // Guarantee at least 3 recommendations with generic fallbacks
  if (recs.length < 3) {
    recs.push({
      title: "Interaja ativamente com os seguidores",
      description:
        "Responder comentários e mensagens diretas aumenta o engajamento orgânico e fortalece o relacionamento com a audiência.",
      priority: "medium",
    });
  }

  if (recs.length < 3) {
    recs.push({
      title: "Diversifique os formatos de conteúdo",
      description:
        "Combinar Reels, carrosséis e imagens estáticas amplia o alcance e atende a diferentes preferências da audiência.",
      priority: "low",
    });
  }

  if (recs.length < 3) {
    recs.push({
      title: "Analise os melhores horários de publicação",
      description:
        "Publicar nos horários de maior atividade dos seguidores maximiza o alcance imediato e favorece o desempenho orgânico.",
      priority: "low",
    });
  }

  // Cap at 5 recommendations
  return recs.slice(0, 5);
}
