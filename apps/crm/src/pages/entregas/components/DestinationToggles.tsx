import { useId, useState } from 'react';
import { Check } from 'lucide-react';
import { PLATFORM_DEFS, type PlatformId } from '@mesaas/platforms';
import { PLATFORM_ICONS } from '@/components/platformIcons';
import type { DestinationToggleOption } from '../postDestinations';

/**
 * Linha "Destinos" do editor de post (spec UX 2, P2). Só aparece com
 * feature_multiplatform; substitui o PlatformSelector. As opções vêm de
 * destinationToggleOptions (plataformas do quadro + destinos que o post já tem).
 * Nunca deixa o post sem destino (mesma regra de PlatformChips).
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
      <div
        role="group"
        aria-labelledby={labelId}
        style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}
      >
        {options.map((o) => {
          const Icon = PLATFORM_ICONS[o.platform];
          const reason = lockedReason ?? o.disabledReason;
          return (
            // span: title não aparece em botão desabilitado (sem pointer events)
            <span key={o.platform} title={reason ?? undefined}>
              <button
                type="button"
                aria-pressed={o.on}
                disabled={pending || reason !== null}
                className={`platform-chip${o.on ? ' platform-chip--on' : ''}`}
                onClick={() => {
                  if (o.on && onCount === 1) {
                    setLastHint(true);
                    return;
                  }
                  setLastHint(false);
                  onToggle(o.platform, !o.on);
                }}
              >
                <Icon size={14} aria-hidden="true" />
                {PLATFORM_DEFS[o.platform].label}
                {o.on && <Check size={14} aria-hidden="true" />}
              </button>
            </span>
          );
        })}
      </div>
      {lastHint && (
        <p style={{ fontSize: '0.72rem', color: 'var(--danger-text)', margin: '0.35rem 0 0' }}>
          O post precisa de pelo menos um destino.
        </p>
      )}
    </div>
  );
}
