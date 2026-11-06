// Rótulos pt-BR dos KPIs do Google Meu Negócio no relatório. TS PURO: lido pela edge function
// (metas da IA em tiptap-doc.ts) e pelo pacote React (packages/report-blocks reexporta). Iguais
// aos da aba Google Meu Negócio (packages/i18n/locales/pt/analyticsGoogle.json `kpi.*`;
// packages/report-blocks/__tests__/platform.test.ts confere a paridade).
import type { GbpKpiId } from "../gbp-analytics/kpis.ts";

export const GBP_KPI_LABELS_PT: Record<GbpKpiId, string> = {
  profile_views: "Visualizações do perfil",
  calls: "Ligações",
  directions: "Pedidos de rota",
  website_clicks: "Cliques no site",
  messages: "Mensagens",
  bookings: "Agendamentos",
  avg_rating: "Nota média",
  new_reviews: "Novas avaliações",
};

export const GBP_KPI_TOOLTIPS_PT: Partial<Record<GbpKpiId, string>> = {
  profile_views:
    "Soma das pessoas diferentes que viram o perfil a cada dia em cada superfície. Quem viu na Pesquisa e no Maps no mesmo dia conta duas vezes.",
};
