// Drawer "Adicionar widget" escopado na seção (spec 2026-10-28-report-platform-sections
// §Editor): a seção de uma plataforma lista os widgets dela e os neutros; a Geral só os
// neutros. A capa só aparece na Geral e só enquanto o layout não tem capa. Nunca lista
// um tipo que insertBlockInSection recusaria na seção.
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  WIDGET_CATALOG,
  WIDGET_CATEGORIES,
  type WidgetCatalogEntry,
} from '@mesaas/report-blocks/catalog';
import { PLATFORM_NAMES, type ReportPlatform } from '@mesaas/report-blocks/platform';
import type { BlockType, ReportDocSnapshot, SectionKind } from '@mesaas/report-blocks/types';
import { FALLBACK_WIDGET_ICON, WIDGET_ICONS } from './widgetIcons';

/** Plataformas com dados no documento: Instagram enquanto não estiver
 * desconectado, TikTok quando o snapshot traz a seção. Nenhuma com dado cai no
 * Instagram, como a capa (coverDefaults). "Adicionar seção" do relatório só
 * oferece estas. */
export function documentPlatforms(snapshot: ReportDocSnapshot): ReportPlatform[] {
  const out: ReportPlatform[] = [];
  if (snapshot.instagram_connected !== false) out.push('instagram');
  if (snapshot.tiktok) out.push('tiktok');
  return out.length ? out : ['instagram'];
}

/** Widgets que a seção aceita, na ordem do catálogo. */
export function drawerWidgets(kind: SectionKind, hasCover: boolean): WidgetCatalogEntry[] {
  return WIDGET_CATALOG.filter((w) => {
    if (w.type === 'cover') return kind === 'general' && !hasCover;
    return w.platform === null || w.platform === kind;
  });
}

const SECTION_NAMES: Record<SectionKind, string> = { general: 'Geral', ...PLATFORM_NAMES };

export interface AddWidgetDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert: (type: BlockType) => void;
  /** Seção que recebe o widget. null = fim do relatório (só neutros, que
   * qualquer seção aceita; sem capa). */
  section: { kind: SectionKind } | null;
  /** O layout já tem uma capa (a capa só é oferecida enquanto não tem). */
  hasCover: boolean;
}

export function AddWidgetDrawer({
  open,
  onOpenChange,
  onInsert,
  section,
  hasCover,
}: AddWidgetDrawerProps) {
  // Sem seção (fim do relatório), a capa nunca: insertBlock a poria na última
  // seção que a aceita, que pode ser a de uma plataforma.
  const widgets = section ? drawerWidgets(section.kind, hasCover) : drawerWidgets('general', true);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Adicionar widget</SheetTitle>
          {section ? (
            <SheetDescription>Na seção {SECTION_NAMES[section.kind]}</SheetDescription>
          ) : (
            <SheetDescription className="sr-only">No fim do relatório</SheetDescription>
          )}
        </SheetHeader>
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
