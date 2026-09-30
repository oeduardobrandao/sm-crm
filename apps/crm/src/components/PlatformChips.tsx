import { useState } from 'react';
import { Check, FileDown, Instagram, Music2, Youtube } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  COMING_SOON_PLATFORMS,
  PLATFORM_DEFS,
  PLATFORM_IDS,
  type PlatformId,
} from '@mesaas/platforms';
import { useWorkspaceLimits } from '@/hooks/useWorkspaceLimits';

const ICONS: Record<PlatformId, LucideIcon> = {
  instagram: Instagram,
  tiktok: Music2,
  geral: FileDown,
};

/**
 * Plataformas de um quadro, template ou cliente (spec 2026-09-29). A ordem de
 * saída segue PLATFORM_IDS. Nunca emite lista vazia: o banco exige >= 1.
 */
export function PlatformChips({
  value,
  onChange,
  id,
}: {
  value: PlatformId[];
  onChange: (next: PlatformId[]) => void;
  id?: string;
}) {
  const { features } = useWorkspaceLimits();
  const [emptyHint, setEmptyHint] = useState(false);

  const visible = PLATFORM_IDS.filter((p) => {
    const flag = PLATFORM_DEFS[p].planFeature;
    return !flag || features?.[flag] === true || value.includes(p);
  });

  const toggle = (p: PlatformId) => {
    const on = value.includes(p);
    if (on && value.length === 1) {
      setEmptyHint(true);
      return;
    }
    setEmptyHint(false);
    const set = new Set(on ? value.filter((x) => x !== p) : [...value, p]);
    onChange(PLATFORM_IDS.filter((x) => set.has(x)));
  };

  return (
    <div id={id}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
        {visible.map((p) => {
          const Icon = ICONS[p];
          const on = value.includes(p);
          return (
            <button
              key={p}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(p)}
              className={`platform-chip${on ? ' platform-chip--on' : ''}`}
            >
              <Icon size={14} aria-hidden="true" />
              {PLATFORM_DEFS[p].label}
              {on && <Check size={14} aria-hidden="true" />}
            </button>
          );
        })}
        {COMING_SOON_PLATFORMS.map((p) => (
          <button key={p.id} type="button" disabled className="platform-chip platform-chip--soon">
            <Youtube size={14} aria-hidden="true" />
            {p.label} <span className="platform-chip__soon">em breve</span>
          </button>
        ))}
      </div>
      {emptyHint && (
        <p style={{ fontSize: '0.72rem', color: 'var(--danger-text)', margin: '0.35rem 0 0' }}>
          Escolha pelo menos uma plataforma.
        </p>
      )}
      <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', margin: '0.35rem 0 0' }}>
        Geral é conteúdo para baixar, sem publicação automática.
      </p>
    </div>
  );
}
