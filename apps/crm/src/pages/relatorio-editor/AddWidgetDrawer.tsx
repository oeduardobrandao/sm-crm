import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { WIDGET_CATALOG, WIDGET_CATEGORIES } from '@mesaas/report-blocks/catalog';
import type { BlockType } from '@mesaas/report-blocks/types';

export interface AddWidgetDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert: (type: BlockType) => void;
}

export function AddWidgetDrawer({ open, onOpenChange, onInsert }: AddWidgetDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Adicionar widget</SheetTitle>
        </SheetHeader>
        {WIDGET_CATEGORIES.map((cat) => (
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
              {WIDGET_CATALOG.filter((w) => w.category === cat).map((w) => (
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
                  }}
                >
                  {w.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </SheetContent>
    </Sheet>
  );
}
