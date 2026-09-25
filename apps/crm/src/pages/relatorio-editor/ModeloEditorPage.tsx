// Editor de modelo (spec 2026-09-25 §2): o mesmo canvas do relatório, com
// dados de exemplo e a marca real do workspace, gravando em report_templates.
// Sem PDF, atualizar dados, ver como cliente ou salvar/aplicar template.
import { useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Info, Plus, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { makeSnapshotFixture } from '@mesaas/report-blocks/fixtures';
import type { ReportBlock } from '@mesaas/report-blocks/types';
import '@mesaas/report-blocks/styles.css';
import { getReportTemplate, type ReportTemplateRow } from '../../services/reportTemplates';
import { getCurrentWorkspace, getWorkspaceBranding } from '../../store';
import { useLayoutAutosave } from './useLayoutAutosave';
import { TEMPLATE_AUTOSAVE_TARGET } from './templateAutosave';
import { useBlockEditing } from './useBlockEditing';
import { EditorCanvas } from './EditorCanvas';
import { TextBlockEditor } from './TextBlockEditor';
import { AddWidgetDrawer } from './AddWidgetDrawer';
import { LayersPanel } from './LayersPanel';
import { AppearancePopover } from './AppearancePopover';
import { moveBlock, normalizeCoverSize, updateBlockConfig, updateBlockText } from './layoutOps';

const SETTINGS_PATH = '/configuracao/relatorios';

function AiPlaceholder() {
  return (
    <div
      style={{
        border: '1px dashed var(--border-color)',
        borderRadius: 10,
        padding: '1rem',
        color: 'var(--text-muted)',
        fontSize: '0.85rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
      }}
    >
      <Sparkles className="h-4 w-4" aria-hidden="true" />
      Gerado pela IA em cada relatório
    </div>
  );
}

function ModeloEditorBody({ template }: { template: ReportTemplateRow }) {
  const { data: workspace } = useQuery({
    queryKey: ['currentWorkspace'],
    queryFn: getCurrentWorkspace,
  });
  const { data: branding } = useQuery({
    queryKey: ['workspace-branding'],
    queryFn: getWorkspaceBranding,
  });
  // Mesmo racional de ReportPreview.tsx: números de exemplo, marca real.
  const snapshot = useMemo(
    () =>
      makeSnapshotFixture({
        account: { handle: 'seucliente', specialty: '' },
        branding: {
          workspace_name: workspace?.name ?? '',
          logo_url: workspace?.logo_url ?? null,
          splash_url: branding?.report_splash_url ?? null,
          accent_color: branding?.brand_color ?? '#eab308',
        },
      }),
    [workspace, branding],
  );

  const { layout, applyLayout, title, setTitle, saving } = useLayoutAutosave(
    template.id,
    { layout: normalizeCoverSize(template.layout), title: template.name },
    TEMPLATE_AUTOSAVE_TARGET,
  );
  // F1 (revisão final): templateAutosave pula a gravação no banco quando o
  // título vem em branco (name é NOT NULL), mas o hook ainda otimiza o cache
  // com o valor em branco. Um draft local, só sincronizado com o hook quando
  // não-vazio, garante que `setTitle` nunca recebe '' -- o guard do target
  // fica só como defesa-em-profundidade.
  const [draftName, setDraftName] = useState(title);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const {
    drawerOpen,
    setDrawerOpen,
    highlightId,
    highlightAndScroll,
    openWidgetDrawer,
    handleInsert,
    handleRemoveBlock,
  } = useBlockEditing(layoutRef, applyLayout);

  return (
    <div className="rb-editor-with-rail">
      <header
        style={{
          maxWidth: 880,
          margin: '0 auto 1rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          flexWrap: 'wrap',
        }}
      >
        <Button variant="outline" size="sm" asChild>
          <Link to={SETTINGS_PATH}>
            <ArrowLeft className="h-3.5 w-3.5" /> Modelos
          </Link>
        </Button>
        <div style={{ flex: 1, minWidth: 220 }}>
          <input
            aria-label="Nome do modelo"
            value={draftName}
            onChange={(e) => {
              const next = e.target.value;
              setDraftName(next);
              if (next.trim()) setTitle(next);
            }}
            onBlur={() => {
              if (!draftName.trim()) setDraftName(title);
            }}
            style={{
              width: '100%',
              border: 'none',
              background: 'transparent',
              fontSize: '1.35rem',
              fontWeight: 700,
              letterSpacing: '-1px',
              color: 'var(--text-main)',
              outline: 'none',
            }}
          />
          <p style={{ margin: '0.15rem 0 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Modelo de relatório
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
      </header>

      <p
        role="note"
        style={{
          maxWidth: 880,
          margin: '0 auto 1.25rem',
          padding: '0.6rem 0.85rem',
          borderRadius: 10,
          background: 'var(--surface-2)',
          color: 'var(--text-muted)',
          fontSize: '0.85rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
        }}
      >
        <Info className="h-4 w-4" aria-hidden="true" />
        Dados de exemplo. Os números reais entram quando o relatório é gerado.
      </p>

      <EditorCanvas
        layout={layout}
        snapshot={snapshot}
        onChange={applyLayout}
        onRemoveBlock={handleRemoveBlock}
        onConfigChange={(id, patch) => applyLayout(updateBlockConfig(layoutRef.current, id, patch))}
        highlightId={highlightId}
        renderTextBlock={(block: ReportBlock) =>
          block.type === 'text' ? (
            <TextBlockEditor
              key={block.id}
              block={block}
              onTextChange={(id, json) => applyLayout(updateBlockText(layoutRef.current, id, json))}
            />
          ) : (
            <AiPlaceholder key={block.id} />
          )
        }
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
    </div>
  );
}

export default function ModeloEditorPage() {
  const { id } = useParams<{ id: string }>();
  const {
    data: template,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['report-template', id],
    queryFn: () => getReportTemplate(id!),
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

  // F5 (revisão final): getReportTemplate falhar (rede, RLS, etc.) não é o
  // mesmo caso de um id que simplesmente não existe -- a cópia tem que dizer
  // qual dos dois aconteceu.
  if (isError) {
    return (
      <div style={{ padding: '2rem' }}>
        <p style={{ color: 'var(--text-muted)' }}>Não foi possível carregar o modelo.</p>
        <Link to={SETTINGS_PATH}>Voltar para os modelos</Link>
      </div>
    );
  }

  if (!template) {
    return (
      <div style={{ padding: '2rem' }}>
        <p style={{ color: 'var(--text-muted)' }}>Modelo não encontrado.</p>
        <Link to={SETTINGS_PATH}>Voltar para os modelos</Link>
      </div>
    );
  }

  return <ModeloEditorBody key={template.id} template={template} />;
}
