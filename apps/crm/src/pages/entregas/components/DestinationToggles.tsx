import { useId, useState } from 'react';
import { PLATFORM_DEFS, type PlatformId } from '@mesaas/platforms';
import { PLATFORM_ICONS } from '@/components/platformIcons';
import { TooltipProvider } from '@/components/ui/tooltip';
import { IconTip } from './IconTip';
import type { DestinationToggleOption } from '../postDestinations';

/**
 * Linha "Destinos" do editor de post (spec UX 2, P2). Só aparece com
 * feature_multiplatform; substitui o PlatformSelector. As opções vêm de
 * destinationToggleOptions (plataformas do quadro + destinos que o post já tem).
 * Nunca deixa o post sem destino (mesma regra de PlatformChips). Botões só-ícone:
 * o nome e o motivo de bloqueio ficam no tooltip.
 */
export function DestinationToggles({
  options,
  lockedReason,
  pending,
  onToggle,
}: {
  options: DestinationToggleOption[];
  /** Agendado ou já publicado: nada muda. */
  lockedReason: string | null;
  /** Escrita em voo ou destinos carregando. */
  pending: boolean;
  onToggle: (platform: PlatformId, on: boolean) => void;
}) {
  const [lastHint, setLastHint] = useState(false);
  // Único por instância: o WorkflowDrawer pode ter vários posts expandidos.
  const labelId = useId();
  if (options.length === 0) return null;
  const onCount = options.filter((o) => o.on).length;

  return (
    <div className="drawer-post-field drawer-post-field--destinos">
      <label id={labelId}>Destinos</label>
      <TooltipProvider delayDuration={200}>
        <div role="group" aria-labelledby={labelId} className="icon-chips">
          {options.map((o) => {
            const Icon = PLATFORM_ICONS[o.platform];
            const label = PLATFORM_DEFS[o.platform].label;
            const reason = lockedReason ?? o.disabledReason;
            return (
              <IconTip key={o.platform} label={label} reason={reason}>
                <button
                  type="button"
                  aria-label={label}
                  aria-pressed={o.on}
                  disabled={pending || reason !== null}
                  className="icon-chip"
                  onClick={() => {
                    if (o.on && onCount === 1) {
                      setLastHint(true);
                      return;
                    }
                    setLastHint(false);
                    onToggle(o.platform, !o.on);
                  }}
                >
                  <Icon size={16} aria-hidden="true" />
                </button>
              </IconTip>
            );
          })}
        </div>
      </TooltipProvider>
      {lastHint && (
        <p style={{ fontSize: '0.72rem', color: 'var(--danger-text)', margin: '0.35rem 0 0' }}>
          O post precisa de pelo menos um destino.
        </p>
      )}
    </div>
  );
}
