// Espelha os guards "sem dado -> return null" de cada widget, para o modo de
// EDIÇÃO do CRM mostrar um placeholder explicativo em vez de uma célula vazia
// e muda (a razão de "Cliques no link" parecer inutilizável). View, Hub e
// print seguem omitindo o bloco — contrato do KpiEntry e dos widgets.
import type { ReportBlock, ReportDocSnapshot, ReportKpiId, ReportSection } from './types';
import { BLOCK_TYPES, TIKTOK_BLOCK_PREFIX, blockPlatform } from './types';
import { instagramAbsent, tiktokBlockView } from './platform';

export function blockHasData(block: ReportBlock, snapshot: ReportDocSnapshot): boolean {
  const t = block.type;
  if (t.startsWith(TIKTOK_BLOCK_PREFIX)) {
    // tiktok_*: sem seção TikTok = sem dado; com ela, a mesma checagem do tipo
    // base contra a visão (tiktok_kpi_likes -> kpis.likes da seção TikTok).
    const view = tiktokBlockView(block, snapshot);
    return view ? blockHasData(view.block, view.snapshot) : false;
  }
  if (instagramAbsent(t, snapshot)) return false;
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
    case 'image':
      // Sem arquivo = bloco vazio. O editor mostra a área de soltar
      // (ImageBlockEditor), nunca o placeholder genérico.
      return typeof block.config?.file_id === 'number';
    default:
      // Estrutura e texto sempre "têm dado" (cabeçalho vazio ganha editor
      // próprio no modo edição, não placeholder).
      return true;
  }
}

/** View e print (spec 2026-10-28 seções §Rendering): uma seção de plataforma com título
 * visível some inteira (título, subtítulos e texto) quando nenhum widget de plataforma dela
 * tem dado; neutros (section_header, text, divider...) não contam, então uma seção vazia
 * também some. Geral e seções com hideHeader (todo legado convertido) sempre aparecem e
 * seguem a regra por bloco de hoje. */
export function sectionVisibleInView(section: ReportSection, snapshot: ReportDocSnapshot): boolean {
  if (section.kind === 'general') return true;
  if (section.marker.config?.hideHeader === true) return true;
  // Tipo desconhecido (bloco de um bundle mais novo) não conta: este renderer não o desenha.
  return section.blocks.some(
    (b) =>
      (BLOCK_TYPES as readonly string[]).includes(b.type) &&
      blockPlatform(b.type) !== null &&
      blockHasData(b, snapshot),
  );
}
