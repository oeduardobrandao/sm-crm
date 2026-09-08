import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Save, GripVertical } from 'lucide-react';
import { toast } from 'sonner';
import { useUnsavedWork } from '@mesaas/app-lifecycle';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  getHubPages,
  upsertHubPage,
  removeHubPage,
  reorderHubPages,
  type HubPageRow,
} from '@/store';
import { HubRoleGate, useHubPortalDataEnabled } from './HubRoleGate';
import { PaginaRichTextEditor } from './PaginaRichTextEditor';
import { readPageDocResult, writePageContent, isLegacyContent } from './pageContent';
import { usePageDraft } from './usePageDraft';
import type { ClienteDetalheOutletContext } from '../clienteTabs.model';

export default function PaginasPage() {
  const { clienteId, cliente } = useOutletContext<ClienteDetalheOutletContext>();
  const qc = useQueryClient();
  // Tri-state: só um `can('configuracoes','editar')` resolvido como `true` libera a
  // busca; 'unknown' (membership ainda carregando) mantém a query desligada.
  const canLoadPortalData = useHubPortalDataEnabled();
  // An agent never sees the pages data (HubRoleGate below withholds it) — don't fetch it
  // just to discard it at render.
  const { data: pages, isLoading } = useQuery({
    queryKey: ['hub-pages-crm', clienteId],
    queryFn: () => getHubPages(clienteId),
    enabled: canLoadPortalData,
    // `structuralSharing` (padrão true) preservaria a MESMA referência de `data` depois de
    // um refetch cujo conteúdo bate byte a byte com o cache antigo -- exatamente o caso de
    // uma reordenação rejeitada (o servidor devolve a ordem original, igual à já em cache).
    // PagesEditor ressincroniza seu estado local de arrasto num efeito que depende dessa
    // referência (`[pages]`); sem desligar o structural sharing aqui, esse efeito nunca
    // dispararia de novo depois de uma rejeição parcial de reorderHubPages, e a ordem
    // otimista ficaria pendurada na tela mesmo o banco nunca tendo mudado.
    structuralSharing: false,
  });

  if (!cliente.conta_id) return null;

  return (
    <div className="hub-page">
      <header className="hub-page__head">
        <div>
          <h2 className="hub-page__title">Páginas</h2>
          <p className="hub-page__sub">Páginas de conteúdo publicadas no portal do cliente.</p>
        </div>
      </header>
      <HubRoleGate>
        <PagesEditor
          clienteId={clienteId}
          contaId={cliente.conta_id}
          pages={pages ?? []}
          isLoading={isLoading}
          onSaved={() => qc.invalidateQueries({ queryKey: ['hub-pages-crm', clienteId] })}
        />
      </HubRoleGate>
    </div>
  );
}

/** Rail item: drag handle (dnd-kit) + botão de seleção, com badge quando o
 * conteúdo ainda é markdown/bloco legado (será migrado para richtext ao salvar). */
function SortablePageRow({
  page,
  active,
  onSelect,
}: {
  page: HubPageRow;
  active: boolean;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: page.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const legacy = isLegacyContent(page.content);

  return (
    <div ref={setNodeRef} style={style} className="hub-paginas__row">
      <button
        type="button"
        className="hub-paginas__drag-handle"
        aria-label="Reordenar página"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={14} />
      </button>
      <button
        type="button"
        className="hub-paginas__list-item"
        data-active={active}
        onClick={onSelect}
      >
        <span className="hub-paginas__list-item-title">
          {page.title || <span className="italic opacity-60">Sem título</span>}
        </span>
        {legacy && <span className="hub-paginas__badge">Markdown</span>}
      </button>
    </div>
  );
}

function PagesEditor({
  clienteId,
  contaId,
  pages,
  isLoading,
  onSaved,
}: {
  clienteId: number;
  contaId: string;
  pages: HubPageRow[];
  isLoading: boolean;
  onSaved: () => void;
}) {
  // `null` tem dois significados possíveis aqui: "ainda não escolhemos nada" (antes da
  // 1ª carga) e "o usuário está compondo uma página nova". O ref de inicialização abaixo
  // decide qual dos dois é, e só decide UMA vez -- depois disso, `null` sempre quer dizer
  // "página nova" e nunca é sobrescrito pelo efeito de seleção padrão.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const initializedRef = useRef(false);
  const [dirty, setDirty] = useState(false);
  const [pendingTarget, setPendingTarget] = useState<{ target: string | null } | null>(null);
  // Incrementado a cada página nova criada com sucesso -- entra na `key` do painel
  // para forçar remount (título/doc voltam a ficar em branco) sem precisar do id
  // da linha recém-inserida, que `upsertHubPage` não devolve.
  const [newDraftNonce, setNewDraftNonce] = useState(0);

  // Seleção inicial: primeira página assim que a lista carrega. Só roda uma vez --
  // depois disso, `selectedId === null` é sempre uma escolha deliberada (nova página).
  useEffect(() => {
    if (isLoading || initializedRef.current) return;
    initializedRef.current = true;
    if (pages.length > 0) setSelectedId(pages[0].id);
  }, [isLoading, pages]);

  // A página selecionada sumiu (removida nesta sessão ou em outra aba) -- cai para a
  // primeira que sobrou, ou para o modo "nova" se não sobrou nenhuma.
  useEffect(() => {
    if (isLoading || selectedId === null) return;
    if (!pages.some((p) => p.id === selectedId)) {
      setSelectedId(pages[0]?.id ?? null);
    }
  }, [isLoading, pages, selectedId]);

  function requestSwitch(target: string | null) {
    if (target === selectedId) return;
    if (dirty) {
      setPendingTarget({ target });
    } else {
      setSelectedId(target);
    }
  }

  function confirmSwitch() {
    if (pendingTarget) setSelectedId(pendingTarget.target);
    setPendingTarget(null);
  }

  const handleDirtyChange = useCallback((next: boolean) => setDirty(next), []);

  const handleChildSaved = useCallback(
    (wasCreate: boolean) => {
      if (wasCreate) setNewDraftNonce((n) => n + 1);
      onSaved();
    },
    [onSaved],
  );

  // ── Reordenação (dnd-kit) ──────────────────────────────────────────────────
  // Estado local só para o feedback visual imediato do arrasto -- a fonte da
  // verdade continua sendo `pages` (a query). Depois de toda tentativa de
  // reordenar, sucesso ou falha, `onSaved()` invalida a query; quando a lista
  // fresca chega, este efeito resincroniza `orderedPages` com o que o banco
  // realmente tem, então uma ordem otimista nunca fica "pendurada" após uma
  // rejeição parcial do Promise.all em reorderHubPages.
  const [orderedPages, setOrderedPages] = useState<HubPageRow[]>(pages);
  useEffect(() => {
    setOrderedPages(pages);
  }, [pages]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = orderedPages.findIndex((p) => p.id === active.id);
    const newIndex = orderedPages.findIndex((p) => p.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const next = arrayMove(orderedPages, oldIndex, newIndex);
    setOrderedPages(next);
    try {
      await reorderHubPages(
        clienteId,
        next.map((p) => p.id),
      );
    } catch {
      toast.error('Erro ao reordenar páginas.');
    } finally {
      // Sempre busca de novo, dê certo ou errado: um update por linha
      // (Promise.all) pode ter renumerado só parte da lista, e o que a tela
      // mostra precisa ser sempre o que o banco tem, nunca a ordem otimista.
      onSaved();
    }
  }

  const currentPage = selectedId ? (pages.find((p) => p.id === selectedId) ?? null) : null;

  return (
    <div className="hub-paginas__split">
      <aside className="hub-paginas__rail">
        <Button
          size="sm"
          variant="outline"
          className="w-full justify-start"
          onClick={() => requestSwitch(null)}
        >
          <Plus size={14} className="mr-1.5" /> Nova página
        </Button>

        {isLoading ? (
          <div className="py-6 flex justify-center">
            <Spinner size="sm" />
          </div>
        ) : pages.length === 0 ? (
          <p className="hub-paginas__rail-empty">Nenhuma página ainda.</p>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={orderedPages.map((p) => p.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="hub-paginas__list">
                {orderedPages.map((p) => (
                  <SortablePageRow
                    key={p.id}
                    page={p}
                    active={selectedId === p.id}
                    onSelect={() => requestSwitch(p.id)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </aside>

      <div className="hub-paginas__main">
        {isLoading ? (
          <div className="py-8 flex justify-center">
            <Spinner size="md" />
          </div>
        ) : (
          <PageEditorPane
            key={selectedId ?? `new-${newDraftNonce}`}
            clienteId={clienteId}
            contaId={contaId}
            page={currentPage}
            onSaved={handleChildSaved}
            onDeleted={onSaved}
            onDirtyChange={handleDirtyChange}
          />
        )}
      </div>

      <AlertDialog
        open={pendingTarget !== null}
        onOpenChange={(open) => {
          if (!open) setPendingTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Trocar de página sem salvar?</AlertDialogTitle>
            <AlertDialogDescription>
              Você tem alterações não salvas nesta página. Elas ficam guardadas neste navegador e
              você pode continuar depois, mas ainda não foram enviadas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuar editando</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSwitch}>Trocar mesmo assim</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PageEditorPane({
  clienteId,
  contaId,
  page,
  onSaved,
  onDeleted,
  onDirtyChange,
}: {
  clienteId: number;
  contaId: string;
  page: HubPageRow | null;
  onSaved: (wasCreate: boolean) => void;
  onDeleted: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const loaded = useMemo(() => readPageDocResult(page?.content), [page?.content]);
  const legacy = useMemo(() => isLegacyContent(page?.content), [page?.content]);
  const { draft, saveDraft, clearDraft } = usePageDraft(page?.id ?? null);

  const [title, setTitle] = useState(page?.title ?? '');
  const [doc, setDoc] = useState<Record<string, unknown>>(draft ?? loaded.doc);
  const [saving, setSaving] = useState(false);

  const docRef = useRef(doc);
  docRef.current = doc;
  const draftTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const isDirty =
    title !== (page?.title ?? '') || JSON.stringify(doc) !== JSON.stringify(loaded.doc);

  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  // Sobrevive a fechar a aba/navegar para fora do app -- navegação DENTRO da SPA é
  // deliberadamente livre (o blocker de navegação do React Router é proibido neste
  // projeto; ver usePageDraft.ts), o rascunho no localStorage é quem protege esse caso.
  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);

  // Segura a troca silenciosa de versão entre deploys enquanto há edição ou salvamento
  // em andamento -- mecanismo independente do beforeunload acima (ver @mesaas/app-lifecycle).
  useUnsavedWork(isDirty || saving);

  useEffect(
    () => () => {
      if (draftTimeoutRef.current) clearTimeout(draftTimeoutRef.current);
    },
    [],
  );

  function handleEditorChange(next: Record<string, unknown>) {
    setDoc(next);
    // Grava o rascunho com um pequeno debounce -- uma página grande gera um JSON
    // grande, e regravar o localStorage a cada tecla pode travar a digitação.
    if (draftTimeoutRef.current) clearTimeout(draftTimeoutRef.current);
    draftTimeoutRef.current = setTimeout(() => {
      saveDraft(docRef.current);
    }, 400);
  }

  async function handleSave() {
    if (!title.trim()) {
      toast.error('Dê um título para a página.');
      return;
    }
    if (draftTimeoutRef.current) {
      clearTimeout(draftTimeoutRef.current);
      draftTimeoutRef.current = undefined;
    }
    const wasCreate = !page;
    setSaving(true);
    try {
      await upsertHubPage({
        ...(page?.id ? { id: page.id } : {}),
        cliente_id: clienteId,
        conta_id: contaId,
        title: title.trim(),
        content: writePageContent(doc),
      });
      clearDraft();
      toast.success('Página salva!');
      onSaved(wasCreate);
    } catch (e: any) {
      toast.error(e?.message ?? 'Erro ao salvar página.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!page) return;
    if (!window.confirm('Remover esta página? Essa ação não pode ser desfeita.')) return;
    try {
      await removeHubPage(page.id);
      clearDraft();
      toast.success('Página removida.');
      onDeleted();
    } catch (e: any) {
      toast.error(e?.message ?? 'Erro ao remover página.');
    }
  }

  return (
    <div className="hub-paginas__editor">
      {legacy && (
        <p className="hub-paginas__legacy-note">
          Conteúdo em markdown. Será convertido para o novo formato ao salvar.
        </p>
      )}
      {!loaded.converted && (
        <p className="hub-paginas__legacy-note hub-paginas__legacy-note--warn">
          Não foi possível converter automaticamente todo o conteúdo antigo. Revise o texto abaixo
          antes de salvar.
        </p>
      )}

      <div className="hub-paginas__toolbar-row">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Título da página"
          className="hub-paginas__title-input"
        />
        <div className="hub-paginas__toolbar-actions">
          {isDirty && <span className="hub-paginas__dirty-badge">Alterações não salvas</span>}
          {page && (
            <Button size="sm" variant="ghost" onClick={handleDelete} aria-label="Remover página">
              <Trash2 size={14} />
            </Button>
          )}
          <Button size="sm" onClick={handleSave} disabled={saving}>
            <Save size={14} className="mr-1.5" /> Salvar
          </Button>
        </div>
      </div>

      <PaginaRichTextEditor doc={doc} onChange={handleEditorChange} />
    </div>
  );
}
