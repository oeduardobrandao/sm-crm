// Plataformas num modelo do workspace (spec 2026-10-28-report-platform-sections §Generation).
// Na geração o modelo é lido em seções (o legado é convertido): a seção de uma plataforma
// desmarcada (ou sem dados) sai inteira, com subtítulos e textos; e, só se o modelo tem alguma
// seção de plataforma, cada plataforma escolhida (com dados) que ele não cobre ganha a seção
// padrão dela logo depois da última seção de plataforma do modelo. Os modelos são semeados só
// com Instagram, então sem isso um relatório só TikTok a partir do modelo padrão sairia vazio.
// O que o modelo já cobre nunca é reescrito. TS PURO (Deno e Vite).
import { platformSectionBlocks, type PlatformSectionOpts } from "./default-layout.ts";
import { MAX_BLOCKS, MAX_SECTIONS, type ReportLayout } from "./layout.ts";
import {
  makeSectionMarker, type ReportSection, sectionPlatforms, type SectionPlatform, toSections,
  fromSections,
} from "./sections.ts";

export type LayoutPlatform = SectionPlatform;

// Ordem fixa das seções acrescentadas (Instagram antes do TikTok), como no layout padrão.
const PLATFORM_ORDER: readonly LayoutPlatform[] = ["instagram", "tiktok"];

export interface SelectPlatformSectionsOpts {
  /** A plataforma tem dados no snapshot. Sem dados, a seção dela sai e nenhuma é acrescentada. */
  hasData: (platform: LayoutPlatform) => boolean;
  /** Molda a seção padrão acrescentada (audiência, horários, tags). */
  sectionOpts: PlatformSectionOpts;
  /** Ids dos blocos acrescentados (marcador e conteúdo, nessa ordem) e dos marcadores que a
   * conversão de um modelo legado sintetiza. Ausente = crypto.randomUUID(). */
  makeId?: () => string;
  /** Seção que não coube (MAX_BLOCKS ou MAX_SECTIONS) e ficou de fora. */
  onCapSkip?: (platform: LayoutPlatform) => void;
}

/** Layout canônico de um documento gerado a partir de um modelo do workspace. Ver o cabeçalho.
 * O teto é decidido seção a seção, na ordem Instagram, TikTok, contra o layout já filtrado: a
 * que não cabe fica de fora (`onCapSkip`) e a seguinte ainda pode entrar. */
export function selectPlatformSections(
  layout: ReportLayout,
  selected: readonly LayoutPlatform[],
  opts: SelectPlatformSectionsOpts,
): ReportLayout {
  const sections = toSections(layout, opts.makeId);
  const keep = (s: ReportSection) =>
    s.kind === "general" || (selected.includes(s.kind) && opts.hasData(s.kind));
  // Ponto de inserção decidido no modelo, antes de filtrar: logo depois da última seção de
  // plataforma dele, tenha ela ficado ou não. Modelo sem seção de plataforma não ganha nenhuma.
  let lastPlatform = -1;
  sections.forEach((s, i) => {
    if (s.kind !== "general") lastPlatform = i;
  });

  const kept = sections.filter(keep);
  const added: ReportSection[] = [];
  if (lastPlatform !== -1) {
    let contentCount = kept.reduce((n, s) => n + s.blocks.length, 0);
    let sectionCount = kept.length;
    for (const p of PLATFORM_ORDER) {
      if (!selected.includes(p) || !opts.hasData(p) || kept.some((s) => s.kind === p)) continue;
      if (sectionCount + 1 > MAX_SECTIONS) {
        opts.onCapSkip?.(p);
        continue;
      }
      const marker = makeSectionMarker(p, opts.makeId ? { id: opts.makeId() } : {});
      const blocks = platformSectionBlocks(p, opts.sectionOpts, opts.makeId);
      if (contentCount + blocks.length > MAX_BLOCKS) {
        opts.onCapSkip?.(p);
        continue;
      }
      added.push({ marker, kind: p, blocks, synthesized: true });
      contentCount += blocks.length;
      sectionCount += 1;
    }
  }

  const out: ReportSection[] = [];
  sections.forEach((s, i) => {
    if (keep(s)) out.push(s);
    if (i === lastPlatform) out.push(...added);
  });
  return fromSections(out, layout);
}

/** Documento com duas ou mais seções de plataforma mostra todos os títulos de plataforma (tira
 * `hideHeader`): um modelo legado convertido que ganhou a seção TikTok não fica com um TikTok
 * rotulado ao lado de um Instagram sem rótulo. Com uma só, vale o que o modelo diz. Devolve a
 * mesma referência quando não há nada a mudar. */
export function showAllPlatformHeadings(layout: ReportLayout): ReportLayout {
  const sections = toSections(layout);
  const platform = sections.filter((s) => s.kind !== "general");
  if (platform.length < 2 || !platform.some((s) => s.marker.config?.hideHeader === true)) return layout;
  return fromSections(
    sections.map((s) => {
      if (s.kind === "general" || s.marker.config?.hideHeader !== true) return s;
      const title = s.marker.config?.title;
      const marker = makeSectionMarker(s.kind, typeof title === "string" ? { id: s.marker.id, title } : { id: s.marker.id });
      return { ...s, marker };
    }),
    layout,
  );
}

/** Plataformas da narrativa: as seções de plataforma do layout final, dentro da seleção.
 * Layout sem nenhuma seção de plataforma cai na seleção. */
export function narrativePlatforms(
  layout: ReportLayout,
  selected: readonly LayoutPlatform[],
): LayoutPlatform[] {
  const inLayout = sectionPlatforms(layout);
  const both = selected.filter((p) => inLayout.includes(p));
  return both.length > 0 ? both : [...selected];
}
