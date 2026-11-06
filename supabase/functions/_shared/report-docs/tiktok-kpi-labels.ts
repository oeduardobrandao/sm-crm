// Rótulos pt-BR dos KPIs TikTok no relatório. TS PURO: lido pela edge function (metas da IA em
// tiptap-doc.ts) e pelo pacote React (packages/report-blocks/platform.ts reexporta). Iguais aos
// da aba Analytics do TikTok (spec §A3; platform.test.ts confere a paridade com o i18n).
// Exceção: no relatório a taxa leva "por visualização", porque fica ao lado da taxa do
// Instagram (spec §A3).
import type { TikTokKpiId } from "../tiktok-analytics/kpis.ts";

export const TIKTOK_KPI_LABELS_PT: Record<TikTokKpiId, string> = {
  followers_total: "Seguidores",
  followers_gained: "Novos seguidores",
  views: "Visualizações",
  engagement_rate: "Engajamento por visualização",
  likes: "Curtidas",
  comments: "Comentários",
  shares: "Compartilhamentos",
  posts_count: "Vídeos publicados",
  likes_total: "Curtidas totais do perfil",
};
