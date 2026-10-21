import { useId, type ReactNode } from 'react';
import { SegmentedControl } from '@/components/mobile';

export type PhoneEditorTab = 'conteudo' | 'detalhes' | 'publicar' | 'comentarios';

const TAB_LABELS: Record<PhoneEditorTab, string> = {
  conteudo: 'Conteúdo',
  detalhes: 'Detalhes',
  publicar: 'Publicar',
  comentarios: 'Comentários',
};
const ORDER: PhoneEditorTab[] = ['conteudo', 'detalhes', 'publicar', 'comentarios'];

interface PhoneEditorTabsProps {
  value: PhoneEditorTab;
  onChange: (tab: PhoneEditorTab) => void;
  /** Count next to "Comentários" (client messages + open internal threads). */
  commentCount: number;
  panes: Record<PhoneEditorTab, ReactNode>;
}

/**
 * Conteúdo / Detalhes / Publicar / Comentários (D21). Every pane stays mounted and is
 * only hidden: a caption draft registers `useUnsavedWork` and keeps its debounced save
 * in flight, so switching tabs must never unmount it. The panes are plain tabpanels,
 * never dialogs (a permanently mounted dialog would stall silent deploy swaps).
 */
export function PhoneEditorTabs({ value, onChange, commentCount, panes }: PhoneEditorTabsProps) {
  const baseId = useId();
  return (
    <>
      <div className="phone-editor-tabs">
        <SegmentedControl
          aria-label="Seções do post"
          semantics="tablist"
          value={value}
          onChange={onChange}
          options={ORDER.map((tab) => ({
            value: tab,
            id: `${baseId}-tab-${tab}`,
            controls: `${baseId}-pane-${tab}`,
            ariaLabel:
              tab === 'comentarios' && commentCount > 0
                ? `${TAB_LABELS[tab]}, ${commentCount}`
                : undefined,
            label:
              tab === 'comentarios' && commentCount > 0 ? (
                <>
                  {TAB_LABELS[tab]}{' '}
                  <span className="phone-editor-tabs__count" aria-hidden="true">
                    {commentCount}
                  </span>
                </>
              ) : (
                TAB_LABELS[tab]
              ),
          }))}
        />
      </div>
      {ORDER.map((tab) => (
        <div
          key={tab}
          id={`${baseId}-pane-${tab}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${tab}`}
          hidden={value !== tab}
          className="phone-editor-pane"
          data-pane={tab}
        >
          {panes[tab]}
        </div>
      ))}
    </>
  );
}
