// PR 2: o editor do relatório de blocos. Canvas dnd + drawer + TipTap +
// autosave. View/print continuam no BlockRenderer do pacote (Hub, PR 3).
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { ColorPicker } from '@/components/shared/ColorPicker';
import type { BlockType, ReportBlock } from '@mesaas/report-blocks/types';
import '@mesaas/report-blocks/styles.css';
import { getReportDoc, type ReportDocumentRow } from '../../services/reportDocs';
import { useLayoutAutosave } from './useLayoutAutosave';
import { EditorCanvas } from './EditorCanvas';
import { TextBlockEditor } from './TextBlockEditor';
import { AddWidgetDrawer } from './AddWidgetDrawer';
import { insertBlock, setLayoutAccent, updateBlockText } from './layoutOps';

function EditorBody({ doc }: { doc: ReportDocumentRow }) {
  const snapshot = doc.data_snapshot!;
  const { layout, applyLayout, title, setTitle, saving } = useLayoutAutosave(doc.id, {
    layout: doc.layout,
    title: doc.title,
  });
  // renderTextBlock/insert leem o layout por ref: o closure do canvas pode ser
  // de um render anterior e aplicaria updates sobre estado obsoleto.
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Nenhum dos dois timers sobrevive a um unmount: sem isso, um insert seguido
  // de navegação dispara o callback depois que jsdom já derrubou a árvore
  // (scrollIntoView é undefined lá) ou tenta setHighlightId num componente
  // desmontado, vazando pro próximo arquivo de teste que rodar em seguida.
  useEffect(
    () => () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
      if (scrollTimer.current) clearTimeout(scrollTimer.current);
    },
    [],
  );

  function handleInsert(type: BlockType) {
    const { layout: next, newId } = insertBlock(layoutRef.current, type);
    applyLayout(next);
    setHighlightId(newId);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightId(null), 2500);
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => {
      // jsdom não implementa scrollIntoView (undefined no protótipo do
      // elemento) — o `?.()` opcional no MÉTODO, não só no querySelector,
      // evita o TypeError que corrompe o próximo arquivo de teste.
      document
        .querySelector(`[data-block-id="${newId}"]`)
        ?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    }, 50);
  }

  return (
    <div style={{ padding: '1.5rem' }}>
      <header
        style={{
          maxWidth: 880,
          margin: '0 auto 1.25rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: 1, minWidth: 220 }}>
          <input
            aria-label="Título do relatório"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{
              width: '100%',
              border: 'none',
              background: 'transparent',
              fontSize: '1.35rem',
              fontWeight: 700,
              color: 'var(--text-main)',
              outline: 'none',
            }}
          />
          <p style={{ margin: '0.15rem 0 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            {snapshot.period.label}
            {saving && (
              <span className="drawer-saving-indicator" style={{ marginLeft: '0.6rem' }}>
                Salvando…
              </span>
            )}
          </p>
        </div>
        <ColorPicker
          value={layout.accent ?? snapshot.branding.accent_color}
          onChange={(hex) => applyLayout(setLayoutAccent(layoutRef.current, hex))}
          brandColors={[snapshot.branding.accent_color]}
          label="Cor"
        />
        {layout.accent && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => applyLayout(setLayoutAccent(layoutRef.current, undefined))}
          >
            Usar cor da marca
          </Button>
        )}
        <Button size="sm" onClick={() => setDrawerOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> Adicionar widget
        </Button>
      </header>

      <EditorCanvas
        layout={layout}
        snapshot={snapshot}
        onChange={applyLayout}
        highlightId={highlightId}
        renderTextBlock={(block: ReportBlock) => (
          <TextBlockEditor
            key={block.id}
            block={block}
            onTextChange={(id, json) => applyLayout(updateBlockText(layoutRef.current, id, json))}
          />
        )}
      />

      <AddWidgetDrawer open={drawerOpen} onOpenChange={setDrawerOpen} onInsert={handleInsert} />
    </div>
  );
}

export default function RelatorioEditorPage() {
  const { id } = useParams<{ id: string }>();
  const { data: doc, isLoading } = useQuery({
    queryKey: ['report-doc', id],
    queryFn: () => getReportDoc(id!),
    enabled: Boolean(id),
    // O editor é a fonte da verdade após carregar; refetch clobbaria edições.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  if (isLoading) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '50vh' }}>
        <Spinner />
      </div>
    );
  }

  if (!doc || !doc.data_snapshot) {
    return (
      <div style={{ padding: '2rem' }}>
        <p style={{ color: 'var(--text-muted)' }}>Relatório não encontrado.</p>
      </div>
    );
  }

  return <EditorBody key={doc.id} doc={doc} />;
}
