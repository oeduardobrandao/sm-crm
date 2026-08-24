// Espelha os guards "sem dado -> return null" de cada widget, para o modo de
// EDIÇÃO do CRM mostrar um placeholder explicativo em vez de uma célula vazia
// e muda (a razão de "Cliques no link" parecer inutilizável). View, Hub e
// print seguem omitindo o bloco — contrato do KpiEntry e dos widgets.
import type { ReportBlock, ReportDocSnapshot, ReportKpiId } from './types';

export function blockHasData(block: ReportBlock, snapshot: ReportDocSnapshot): boolean {
  const t = block.type;
  if (t.startsWith('kpi_')) {
    // Snapshot antigo pode nem ter a chave (ex.: views pré-2026-08).
    const entry = snapshot.kpis[t.replace(/^kpi_/, '') as ReportKpiId];
    return Boolean(entry) && entry.value !== null;
  }
  switch (t) {
    case 'chart_followers':
      return snapshot.follower_trend.length > 0;
    case 'chart_formats':
      return Object.values(snapshot.content_breakdown).some((b) => b && b.count > 0);
    case 'chart_best_times':
      return snapshot.best_times.length > 0;
    case 'audience_gender':
      return Boolean(snapshot.audience?.gender_split);
    case 'audience_age':
      return (snapshot.audience?.top_age_ranges ?? []).length > 0;
    case 'audience_cities':
      return (snapshot.audience?.top_cities ?? []).length > 0;
    case 'audience_countries':
      return (snapshot.audience?.top_countries ?? []).length > 0;
    case 'top_posts':
    case 'post_list':
      return snapshot.top_posts.length > 0;
    case 'tags_table':
      return snapshot.tags_performance.length > 0;
    default:
      // Estrutura e texto sempre "têm dado" (cabeçalho vazio ganha editor
      // próprio no modo edição, não placeholder).
      return true;
  }
}
