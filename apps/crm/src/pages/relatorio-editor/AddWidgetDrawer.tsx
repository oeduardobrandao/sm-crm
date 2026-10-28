import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { WIDGET_CATALOG, WIDGET_CATEGORIES } from '@mesaas/report-blocks/catalog';
import { PLATFORM_NAMES, type ReportPlatform } from '@mesaas/report-blocks/platform';
import type { BlockType, ReportDocSnapshot } from '@mesaas/report-blocks/types';
import { FALLBACK_WIDGET_ICON, WIDGET_ICONS } from './widgetIcons';

const PLATFORM_ORDER: readonly ReportPlatform[] = ['instagram', 'tiktok'];

/** Plataformas que o documento tem para oferecer no drawer: Instagram enquanto
 * não estiver desconectado, TikTok quando o snapshot traz a seção. Nenhuma com
 * dado cai no Instagram, como a capa (coverDefaults). */
export function documentPlatforms(snapshot: ReportDocSnapshot): ReportPlatform[] {
  const out: ReportPlatform[] = [];
  if (snapshot.instagram_connected !== false) out.push('instagram');
  if (snapshot.tiktok) out.push('tiktok');
  return out.length ? out : ['instagram'];
}

export interface AddWidgetDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert: (type: BlockType) => void;
  /** Plataformas oferecidas. Com duas, aparece o seletor; com uma, só os
   * widgets dela (mais os neutros: Texto, Mídia, Estrutura). */
  platforms: ReportPlatform[];
}

function PlatformSwitch({
  platforms,
  value,
  onChange,
}: {
  platforms: ReportPlatform[];
  value: ReportPlatform;
  onChange: (p: ReportPlatform) => void;
}) {
  // Rádios nativos de mesmo name: o navegador cuida de setas, Tab e do papel
  // radio; o rótulo estilizado vira o segmento.
  return (
    <div
      role="radiogroup"
      aria-label="Plataforma"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${platforms.length}, 1fr)`,
        gap: 2,
        marginTop: '1rem',
        padding: 2,
        border: '1px solid var(--border-color)',
        borderRadius: 10,
        background: 'var(--surface-1)',
      }}
    >
      {platforms.map((p) => (
        <label key={p} style={{ position: 'relative', display: 'block' }}>
          <input
            type="radio"
            name="add-widget-platform"
            value={p}
            checked={value === p}
            onChange={() => onChange(p)}
            className="peer sr-only"
          />
          <span
            className="block cursor-pointer rounded-lg px-3 py-1.5 text-center text-sm font-medium transition-colors peer-checked:bg-[var(--card-bg)] peer-checked:text-[var(--text-main)] peer-checked:shadow-sm peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--primary-color)]"
            style={{ color: 'var(--text-muted)' }}
          >
            {PLATFORM_NAMES[p]}
          </span>
        </label>
      ))}
    </div>
  );
}

export function AddWidgetDrawer({ open, onOpenChange, onInsert, platforms }: AddWidgetDrawerProps) {
  const offered = PLATFORM_ORDER.filter((p) => platforms.includes(p));
  const [chosen, setChosen] = useState<ReportPlatform>('instagram');
  // A escolha vale enquanto a plataforma existir no documento; senão, a primeira.
  const selected = offered.includes(chosen) ? chosen : offered[0];
  const widgets = WIDGET_CATALOG.filter((w) => w.platform === null || w.platform === selected);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Adicionar widget</SheetTitle>
        </SheetHeader>
        {offered.length > 1 && (
          <PlatformSwitch platforms={offered} value={selected} onChange={setChosen} />
        )}
        {WIDGET_CATEGORIES.filter((cat) => widgets.some((w) => w.category === cat)).map((cat) => (
          <div key={cat} style={{ marginTop: '1rem' }}>
            <h4
              style={{
                margin: '0 0 0.5rem',
                fontSize: '0.72rem',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'var(--text-muted)',
              }}
            >
              {cat}
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              {widgets
                .filter((w) => w.category === cat)
                .map((w) => {
                  const TypeIcon = WIDGET_ICONS[w.type] ?? FALLBACK_WIDGET_ICON;
                  return (
                    <button
                      key={w.type}
                      type="button"
                      onClick={() => {
                        onInsert(w.type);
                        onOpenChange(false);
                      }}
                      style={{
                        border: '1px solid var(--border-color)',
                        borderRadius: 8,
                        background: 'var(--card-bg)',
                        padding: '0.6rem 0.5rem',
                        fontSize: '0.8rem',
                        cursor: 'pointer',
                        textAlign: 'center',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '0.3rem',
                      }}
                    >
                      <TypeIcon
                        className="h-4 w-4"
                        style={{ color: 'var(--text-light)' }}
                        aria-hidden
                      />
                      {w.label}
                    </button>
                  );
                })}
            </div>
          </div>
        ))}
      </SheetContent>
    </Sheet>
  );
}
