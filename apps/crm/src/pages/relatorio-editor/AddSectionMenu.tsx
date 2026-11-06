// "Adicionar seção" do canvas (spec 2026-10-28-report-platform-sections §Editor e
// 2026-11-04-gmn-report-section §CRM editor): entre as seções e depois da última. Lista as
// plataformas habilitadas na ordem de PLATFORM_ORDER (TikTok só com feature_tiktok, Google Meu
// Negócio só com feature_google_business: fora do menu sem a flag), depois a Geral. Plataforma
// já presente fica desabilitada; num relatório, a plataforma precisa ter dados no snapshot (num
// modelo, todas valem: dados de exemplo).
import { useId } from 'react';
import { PanelTop, Plus } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PlatformIcon } from '@mesaas/report-blocks/PlatformIcon';
import { PLATFORM_NAMES, type ReportPlatform } from '@mesaas/report-blocks/platform';
import { MAX_SECTIONS, PLATFORM_ORDER, type SectionKind } from '@mesaas/report-blocks/types';
import { DEFAULT_ENABLED_PLATFORMS } from './useBlockEditing';

export interface AddSectionMenuProps {
  /** Tipo de cada seção já no layout (uma entrada por seção). */
  existing: SectionKind[];
  /** Plataformas que o plano libera (Instagram sempre). Fail closed: padrão só Instagram. */
  enabledPlatforms?: readonly ReportPlatform[];
  /** Plataformas com dados. "all" nos modelos; relatório passa documentPlatforms(snapshot). */
  availablePlatforms: ReportPlatform[] | 'all';
  onAdd: (kind: SectionKind) => void;
}

/** Descrição do item quando ele pode ser escolhido (sem dica de bloqueio). */
const PLATFORM_DESCRIPTIONS: Partial<Record<ReportPlatform, string>> = {
  google: 'Visualizações, ligações, rotas, buscas e avaliações',
};

function platformHint(
  platform: ReportPlatform,
  existing: SectionKind[],
  available: ReportPlatform[] | 'all',
): string | null {
  const name = PLATFORM_NAMES[platform];
  if (existing.includes(platform)) return `Já existe uma seção do ${name}`;
  if (available !== 'all' && !available.includes(platform)) {
    return `Sem dados do ${name} neste relatório. Atualize os dados depois de conectar a conta.`;
  }
  return null;
}

export function AddSectionMenu({
  existing,
  enabledPlatforms = DEFAULT_ENABLED_PLATFORMS,
  availablePlatforms,
  onAdd,
}: AddSectionMenuProps) {
  const platforms = PLATFORM_ORDER.filter((p) => enabledPlatforms.includes(p));
  const full = existing.length >= MAX_SECTIONS;
  const fullHintId = useId();
  return (
    <div className="rb-add-section">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="rb-add-section-trigger"
            disabled={full}
            aria-describedby={full ? fullHintId : undefined}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden /> Adicionar seção
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="w-72">
          {platforms.map((p) => {
            const hint = platformHint(p, existing, availablePlatforms);
            const text = hint ?? PLATFORM_DESCRIPTIONS[p] ?? null;
            return (
              <DropdownMenuItem
                key={p}
                disabled={hint !== null}
                onSelect={() => onAdd(p)}
                className="rb-add-section-item"
              >
                <PlatformIcon platform={p} size={16} className="rb-add-section-icon" />
                <span className="rb-add-section-text">
                  <span className="rb-add-section-label">{PLATFORM_NAMES[p]}</span>
                  {text && <span className="rb-add-section-hint">{text}</span>}
                </span>
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuItem onSelect={() => onAdd('general')} className="rb-add-section-item">
            <PanelTop className="rb-add-section-icon h-4 w-4" aria-hidden />
            <span className="rb-add-section-text">
              <span className="rb-add-section-label">Geral</span>
              <span className="rb-add-section-hint">Texto, imagens e análises da IA</span>
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {full && (
        <span id={fullHintId} className="rb-add-section-full">
          Limite de {MAX_SECTIONS} seções por relatório
        </span>
      )}
    </div>
  );
}
