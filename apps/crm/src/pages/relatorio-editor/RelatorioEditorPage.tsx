// PR 2: o editor do relatório de blocos. Canvas dnd + drawer + TipTap +
// autosave. View/print continuam no BlockRenderer do pacote (Hub, PR 3).
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, MoreHorizontal, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Spinner } from '@/components/ui/spinner';
import type { BlockType, ReportBlock } from '@mesaas/report-blocks/types';
import '@mesaas/report-blocks/styles.css';
import {
  exportReportPdf,
  getReportDoc,
  refreshReportDoc,
  type ReportDocumentRow,
} from '../../services/reportDocs';
import { getHubToken, getWorkspaceSlug } from '../../store/hub';
import { useLayoutAutosave } from './useLayoutAutosave';
import { EditorCanvas } from './EditorCanvas';
import { TextBlockEditor } from './TextBlockEditor';
import { AddWidgetDrawer } from './AddWidgetDrawer';
import { LayersPanel } from './LayersPanel';
import { SaveTemplateDialog } from './SaveTemplateDialog';
import { ApplyTemplateDialog } from './ApplyTemplateDialog';
import { AppearancePopover } from './AppearancePopover';
import {
  insertBlockAt,
  moveBlock,
  removeBlock,
  restoreBlock,
  updateBlockConfig,
  updateBlockText,
} from './layoutOps';
import { applyTemplateLayout } from './templateOps';

function EditorBody({ doc }: { doc: ReportDocumentRow }) {
  const qc = useQueryClient();
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
  // Posição de inserção do próximo widget: null = fim do documento. Setada
  // pelos pontos de inserção do painel de camadas antes de abrir o drawer.
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const [saveTplOpen, setSaveTplOpen] = useState(false);
  const [applyTplOpen, setApplyTplOpen] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Link "Ver como cliente": só existe quando o Hub tem um token ativo, não
  // expirado, e o workspace tem slug. Mesma checagem de validade que o
  // servidor faz em expires_at > now() (HubTab.tsx).
  const { data: hubViewLink } = useQuery({
    queryKey: ['hub-view-link', doc.client_id],
    queryFn: async () => {
      const [tok, slug] = await Promise.all([getHubToken(doc.client_id), getWorkspaceSlug()]);
      return tok && slug && tok.is_active && tok.expires_at > new Date().toISOString()
        ? { url: `${window.location.origin}/${slug}/hub/${tok.token}/relatorios/doc/${doc.id}` }
        : null;
    },
  });

  async function handleExportPdf() {
    setExporting(true);
    try {
      const { url } = await exportReportPdf(doc.id);
      // A conversão pode levar 10-60s num cache-miss (Gotenberg): quando o
      // await termina, a ativação transitória de usuário do clique original
      // já pode ter expirado e o browser bloqueia o popup (window.open volta
      // null). Mesmo fallback de AnalyticsContaPage.handleGenerateReport: um
      // <a> clicado programaticamente não depende dessa ativação.
      const win = window.open(url, '_blank', 'noopener');
      if (!win) {
        const a = document.createElement('a');
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao exportar PDF');
    } finally {
      setExporting(false);
    }
  }

  async function handleRefreshData() {
    setRefreshing(true);
    try {
      await refreshReportDoc(doc.id);
      await qc.invalidateQueries({ queryKey: ['report-doc', doc.id] });
      toast.success('Dados atualizados.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao atualizar dados');
    } finally {
      setRefreshing(false);
    }
  }

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

  // Exclusão com desfazer: o toast carrega a posição de origem (idx) — sem
  // ela, "Desfazer" reinseriria sempre no fim, perdendo a ordem do usuário.
  function handleRemoveBlock(id: string) {
    const idx = layoutRef.current.blocks.findIndex((b) => b.id === id);
    const block = layoutRef.current.blocks[idx];
    if (!block) return;
    applyLayout(removeBlock(layoutRef.current, id));
    toast('Bloco excluído.', {
      action: {
        label: 'Desfazer',
        onClick: () => applyLayout(restoreBlock(layoutRef.current, block, idx)),
      },
    });
  }

  function highlightAndScroll(id: string) {
    setHighlightId(id);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightId(null), 2500);
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => {
      // jsdom não implementa scrollIntoView (undefined no protótipo do
      // elemento) — o `?.()` opcional no MÉTODO, não só no querySelector,
      // evita o TypeError que corrompe o próximo arquivo de teste.
      document
        .querySelector(`[data-block-id="${id}"]`)
        ?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    }, 50);
  }

  function openWidgetDrawer(at: number | null) {
    setInsertAt(at);
    setDrawerOpen(true);
  }

  function handleInsert(type: BlockType) {
    const { layout: next, newId } = insertBlockAt(
      layoutRef.current,
      type,
      insertAt ?? layoutRef.current.blocks.length,
    );
    applyLayout(next);
    highlightAndScroll(newId);
  }

  // Padding vive em .rb-editor-with-rail (style.css): inline aqui
  // sobrescreveria o padding-right do gate ≥1280px que reserva o espaço do
  // painel de camadas.
  return (
    <div className="rb-editor-with-rail">
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
        <AppearancePopover layout={layout} snapshot={snapshot} onChange={applyLayout} />
        <Button size="sm" onClick={() => openWidgetDrawer(null)}>
          <Plus className="h-3.5 w-3.5" /> Adicionar widget
        </Button>
        <Button size="sm" disabled={exporting} onClick={handleExportPdf}>
          {exporting ? <Spinner size="sm" /> : <Download className="h-3.5 w-3.5" />} Exportar PDF
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" aria-label="Ações do relatório">
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setSaveTplOpen(true)}>
              Salvar como template
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setApplyTplOpen(true)}>
              Aplicar template
            </DropdownMenuItem>
            <DropdownMenuItem disabled={refreshing} onSelect={handleRefreshData}>
              {refreshing ? 'Atualizando…' : 'Atualizar dados'}
            </DropdownMenuItem>
            {hubViewLink && (
              <DropdownMenuItem onSelect={() => window.open(hubViewLink.url, '_blank', 'noopener')}>
                Ver como cliente
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <EditorCanvas
        layout={layout}
        snapshot={snapshot}
        onChange={applyLayout}
        onRemoveBlock={handleRemoveBlock}
        onConfigChange={(id, patch) => applyLayout(updateBlockConfig(layoutRef.current, id, patch))}
        highlightId={highlightId}
        renderTextBlock={(block: ReportBlock) => (
          <TextBlockEditor
            key={block.id}
            block={block}
            onTextChange={(id, json) => applyLayout(updateBlockText(layoutRef.current, id, json))}
          />
        )}
      />

      <LayersPanel
        layout={layout}
        highlightId={highlightId}
        onReorder={(activeId, overId) =>
          applyLayout(moveBlock(layoutRef.current, activeId, overId))
        }
        onLocate={highlightAndScroll}
        onAddAt={openWidgetDrawer}
        onAddEnd={() => openWidgetDrawer(null)}
      />

      <AddWidgetDrawer open={drawerOpen} onOpenChange={setDrawerOpen} onInsert={handleInsert} />
      <SaveTemplateDialog
        open={saveTplOpen}
        onOpenChange={setSaveTplOpen}
        getLayout={() => layoutRef.current}
      />
      <ApplyTemplateDialog
        open={applyTplOpen}
        onOpenChange={setApplyTplOpen}
        onApply={(tpl) => {
          applyLayout(applyTemplateLayout(tpl.layout, layoutRef.current));
          toast.success('Template aplicado.');
        }}
      />
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
