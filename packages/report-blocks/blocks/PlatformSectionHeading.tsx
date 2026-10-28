// Título de uma seção de plataforma (spec 2026-10-28 seções §Rendering): um item de grid
// em largura cheia, irmão dos blocos dentro do .rb-grid (sem wrapper de seção), um nível
// acima do section_header, que dentro dela vira subtítulo. Sem data-block-id: não é bloco,
// então as regras de célula do styles.css (colapso :empty, flex) não o pegam.
import type { ReportDocSnapshot, ReportSection } from '../types';
import { PLATFORM_NAMES } from '../platform';
import { PlatformIcon } from '../PlatformIcon';

export function PlatformSectionHeading({
  section,
  snapshot,
}: {
  section: ReportSection;
  snapshot: ReportDocSnapshot;
}) {
  if (section.kind === 'general') return null;
  const platform = section.kind;
  const title =
    typeof section.marker.config?.title === 'string' && section.marker.config.title.trim()
      ? section.marker.config.title
      : PLATFORM_NAMES[platform];
  // Handle da conta da plataforma; TikTok sem dado no snapshot fica sem (nunca o do Instagram).
  const handle = platform === 'tiktok' ? snapshot.tiktok?.account.handle : snapshot.account.handle;
  return (
    <div className="rb-full rb-platform-heading" data-section-id={section.marker.id}>
      <PlatformIcon platform={platform} className="rb-platform-heading-icon" size={26} />
      <h2 className="rb-platform-heading-title">{title}</h2>
      {handle ? <span className="rb-platform-heading-handle">@{handle}</span> : null}
    </div>
  );
}
