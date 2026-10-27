import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Save, GripVertical, ArrowUpDown } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useUnsavedWork } from '@mesaas/app-lifecycle';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
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
import { Skeleton } from '@/components/ui/skeleton';
import { DocSkeleton } from '@/components/ui/skeletons';
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
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useOverlayHistoryEntry } from '@/hooks/useOverlayHistoryEntry';
import { Cell, GroupedList } from '@/components/mobile/GroupedList';
import { FormRow } from '@/components/mobile/FormRow';
import { PhoneNavBar } from '@/components/mobile/PhoneNavBar';
import { PhoneIconButton } from '@/components/mobile/LargeTitleHeader';
import { PhoneConfirmSheet } from '@/components/mobile/PhoneConfirmSheet';
import { PhoneEmptyCard, PhoneRow, PhoneSectionList } from '../phone/PhoneRows';
import { PhoneSortableRow } from '../phone/PhoneEditing';
import { ClientePhoneNavActions, useClientePhoneHeader } from '../phone/ClientePhoneChrome';

/** Chave compartilhada entre a query de `PaginasPage` e o resync direto que
 *  `PagesEditor` faz no cache depois de uma reordenação (ver handleDragEnd) --
 *  as duas têm que apontar pra a MESMA entrada do cache. */
function hubPagesQueryKey(clienteId: number) {
  return ['hub-pages-crm', clienteId] as const;
}

export default function PaginasPage() {
  const { clienteId, cliente } = useOutletContext<ClienteDetalheOutletContext>();
  const qc = useQueryClient();
  const { t } = useTranslation('clientHub');
  // Tri-state: só um `can('configuracoes','editar')` resolvido como `true` libera a
  // busca; 'unknown' (membership ainda carregando) mantém a query desligada.
  const canLoadPortalData = useHubPortalDataEnabled();
  // An agent never sees the pages data (HubRoleGate below withholds it) — don't fetch it
  // just to discard it at render.
  const { data: pages, isLoading } = useQuery({
    queryKey: hubPagesQueryKey(clienteId),
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

  const isPhone = !useIsDesktop(768);

  if (!cliente.conta_id) return null;

  return (
    <div className="hub-page">
      <header className="hub-page__head" hidden={isPhone}>
        <div>
          <h2 className="hub-page__title">{t('paginas.title')}</h2>
          <p className="hub-page__sub">{t('paginas.subtitle')}</p>
        </div>
      </header>
      <HubRoleGate>
        {/* `key={clienteId}` força um remount inteiro ao trocar de cliente -- mesma
            lógica do Finding 3 de MarcaPage.tsx: o Outlet de ClienteDetalhePage NÃO
            desmonta ao trocar de cliente na mesma sub-aba quando o cliente de destino
            já está em cache (`isLoading` fica `false`), então sem este `key` o estado
            local de `PagesEditor` (e o `PageEditorPane` por baixo) sobrevive à troca --
            e "Salvar" grava a composição em andamento do cliente A sob o `cliente_id`
            do cliente B. */}
        <PagesEditor
          key={clienteId}
          clienteId={clienteId}
          contaId={cliente.conta_id}
          pages={pages ?? []}
          isLoading={isLoading}
          onSaved={() => qc.invalidateQueries({ queryKey: hubPagesQueryKey(clienteId) })}
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
  dragDisabled,
  onSelect,
}: {
  page: HubPageRow;
  active: boolean;
  dragDisabled: boolean;
  onSelect: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: page.id,
    disabled: dragDisabled,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const legacy = isLegacyContent(page.content);
  const { t } = useTranslation('clientHub');

  return (
    <div ref={setNodeRef} style={style} className="hub-paginas__row">
      <button
        type="button"
        className="hub-paginas__drag-handle"
        aria-label={t('paginas.reorderPage')}
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
          {page.title || <span className="italic opacity-60">{t('paginas.untitled')}</span>}
        </span>
        {legacy && <span className="hub-paginas__badge">{t('paginas.markdown')}</span>}
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
  const qc = useQueryClient();
  const { t } = useTranslation('clientHub');
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

  // Phones (below 768px): a list of pages; a row (or "+") pushes the editor as its own
  // screen under its own nav bar, with a history entry so Back returns to the list (the
  // draft is already in this browser, see usePageDraft). Reordenar is a mode with grips.
  const isPhone = !useIsDesktop(768);
  const [phoneEditorOpen, setPhoneEditorOpen] = useState(false);
  const [sortMode, setSortMode] = useState(false);
  const [phoneRemoveId, setPhoneRemoveId] = useState<string | null>(null);
  const editorScreenOpen = isPhone && phoneEditorOpen;
  useOverlayHistoryEntry(editorScreenOpen, () => setPhoneEditorOpen(false));
  useClientePhoneHeader({
    subtitle: isPhone ? t('paginas.subtitle') : undefined,
    hideNavBar: editorScreenOpen,
  });
  const phoneSensors = useSensors(
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

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
      // Phones: a new page goes back to the list, where it now shows up.
      if (wasCreate) setPhoneEditorOpen(false);
    },
    [onSaved],
  );

  // ── Reordenação (dnd-kit) ──────────────────────────────────────────────────
  // Estado local só para o feedback visual imediato do arrasto -- a fonte da
  // verdade continua sendo `pages` (a query). Depois de toda tentativa de
  // reordenar, sucesso ou falha, `handleDragEnd` invalida a query; quando a
  // lista fresca chega, este efeito resincroniza `orderedPages` com o que o
  // banco realmente tem. `handleDragEnd` também força esse resync direto do
  // cache no seu `finally` (ver comentário lá) -- este efeito continua
  // existindo pra cobrir qualquer outra causa de refetch (ex: outra aba).
  const [orderedPages, setOrderedPages] = useState<HubPageRow[]>(pages);
  useEffect(() => {
    setOrderedPages(pages);
  }, [pages]);

  // Trava contra um segundo drag correndo com o primeiro (Finding 3, fix round 1):
  // sem isto, dois `reorderHubPages` concorrentes podiam pisar um no outro, e não
  // tinha nada impedindo o usuário de largar uma segunda peça enquanto a primeira
  // reordenação ainda estava em voo. Também desabilita o handle de arrasto
  // (useSortable `disabled`) enquanto `true`, então o gesto nem começa.
  const [reordering, setReordering] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function handleDragEnd(event: DragEndEvent) {
    if (reordering) return; // backstop -- os handles já estão `disabled` nesse estado
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = orderedPages.findIndex((p) => p.id === active.id);
    const newIndex = orderedPages.findIndex((p) => p.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const next = arrayMove(orderedPages, oldIndex, newIndex);
    setOrderedPages(next);
    setReordering(true);
    try {
      await reorderHubPages(
        clienteId,
        next.map((p) => p.id),
      );
    } catch {
      toast.error(t('paginas.reorderError'));
    } finally {
      // Sempre busca de novo, dê certo ou errado: um update por linha
      // (Promise.all) pode ter renumerado só parte da lista, e o que a tela
      // mostra precisa ser sempre o que o banco tem, nunca a ordem otimista.
      //
      // `await` aqui (e não fire-and-forget como antes) é o que garante isso: o
      // efeito reativo acima (`[pages]`) só resincroniza `orderedPages` quando a
      // prop `pages` MUDA DE REFERÊNCIA -- e um refetch que FALHA devolve os
      // MESMOS dados de antes (mesma referência), então o efeito nunca dispara de
      // novo e a ordem otimista local ficaria pendurada na tela para sempre. Ler
      // `qc.getQueryData` direto do cache depois do invalidate resolver (sucesso
      // OU falha) e forçar `setOrderedPages` com o que quer que esteja lá agora
      // não depende dessa reatividade.
      await qc.invalidateQueries({ queryKey: hubPagesQueryKey(clienteId) });
      const cached = qc.getQueryData<HubPageRow[]>(hubPagesQueryKey(clienteId));
      setOrderedPages(cached ?? pages);
      setReordering(false);
    }
  }

  const currentPage = selectedId ? (pages.find((p) => p.id === selectedId) ?? null) : null;

  async function handlePhoneRemove(id: string) {
    try {
      await removeHubPage(id);
      toast.success(t('paginas.removed'));
      onSaved();
    } catch (e: any) {
      toast.error(e?.message ?? t('paginas.removeError'));
    }
  }

  if (isPhone) {
    if (editorScreenOpen) {
      return isLoading ? (
        <DocSkeleton />
      ) : (
        <PageEditorPane
          key={`${clienteId}:${selectedId ?? `new-${newDraftNonce}`}`}
          variant="phone"
          clienteId={clienteId}
          contaId={contaId}
          page={currentPage}
          onSaved={handleChildSaved}
          onDeleted={() => {
            setPhoneEditorOpen(false);
            onSaved();
          }}
          onDirtyChange={handleDirtyChange}
          onClose={() => setPhoneEditorOpen(false)}
        />
      );
    }
    const removing = pages.find((p) => p.id === phoneRemoveId) ?? null;
    return (
      <>
        {!sortMode && (
          <ClientePhoneNavActions>
            <PhoneIconButton
              label={t('paginas.newPage')}
              onClick={() => {
                setSelectedId(null);
                setPhoneEditorOpen(true);
              }}
            >
              <Plus aria-hidden="true" />
            </PhoneIconButton>
          </ClientePhoneNavActions>
        )}
        {isLoading ? (
          <DocSkeleton />
        ) : sortMode ? (
          <>
            <div className="phone-cli-reorder-bar">
              <span>{t('paginas.reorderHint')}</span>
              <button
                type="button"
                className="phone-cli-cal__step"
                onClick={() => setSortMode(false)}
              >
                {t('paginas.done')}
              </button>
            </div>
            <DndContext
              sensors={phoneSensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={orderedPages.map((p) => p.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="phone-kit phone-group">
                  <ul className="phone-group__list" aria-label={t('paginas.title')}>
                    {orderedPages.map((p) => (
                      <PhoneSortableRow
                        key={p.id}
                        id={p.id}
                        handleLabel={t('paginas.reorderPageNamed', {
                          title: p.title || t('paginas.untitled'),
                        })}
                      >
                        {p.title || t('paginas.untitled')}
                      </PhoneSortableRow>
                    ))}
                  </ul>
                </div>
              </SortableContext>
            </DndContext>
          </>
        ) : (
          <>
            <PhoneSectionList
              title={t('paginas.title')}
              empty={
                <PhoneEmptyCard title={t('paginas.emptyTitle')} hint={t('paginas.emptyHint')} />
              }
            >
              {orderedPages.map((p) => (
                <PhoneRow
                  key={p.id}
                  title={p.title || t('paginas.untitled')}
                  subtitle={isLegacyContent(p.content) ? t('paginas.markdown') : undefined}
                  onOpen={() => {
                    setSelectedId(p.id);
                    setPhoneEditorOpen(true);
                  }}
                  menuLabel={t('paginas.actionsMenu', {
                    title: p.title || t('paginas.untitled'),
                  })}
                  actions={[
                    {
                      label: t('actions.delete'),
                      icon: <Trash2 aria-hidden="true" />,
                      destructive: true,
                      onSelect: () => setPhoneRemoveId(p.id),
                    },
                  ]}
                />
              ))}
            </PhoneSectionList>
            {orderedPages.length > 1 && (
              <GroupedList aria-label={t('paginas.orderAria')}>
                <Cell
                  label={t('paginas.reorder')}
                  icon={<ArrowUpDown />}
                  iconColor="var(--phone-fill)"
                  chevron={false}
                  disabled={reordering}
                  onClick={() => setSortMode(true)}
                />
              </GroupedList>
            )}
          </>
        )}
        <PhoneConfirmSheet
          open={removing !== null}
          title={t('paginas.removeTitle')}
          message={t('paginas.removeMessage')}
          actions={[
            {
              label: t('actions.delete'),
              destructive: true,
              onSelect: () => {
                const id = phoneRemoveId;
                setPhoneRemoveId(null);
                if (id) void handlePhoneRemove(id);
              },
            },
          ]}
          onCancel={() => setPhoneRemoveId(null)}
        />
      </>
    );
  }

  return (
    <div className="hub-paginas__split">
      <aside className="hub-paginas__rail">
        <Button
          size="sm"
          variant="outline"
          className="w-full justify-start"
          onClick={() => requestSwitch(null)}
        >
          <Plus size={14} className="mr-1.5" /> {t('paginas.newPage')}
        </Button>

        {isLoading ? (
          // Só visual: o skeleton do editor ao lado já anuncia "Carregando…" uma vez.
          <div className="hub-paginas__list" aria-hidden="true">
            {['72%', '58%', '66%'].map((w) => (
              <div key={w} style={{ padding: '0.6rem 0.625rem 0.6rem 1.5rem' }}>
                <Skeleton className="h-3.5" style={{ width: w }} />
              </div>
            ))}
          </div>
        ) : pages.length === 0 ? (
          <p className="hub-paginas__rail-empty">{t('paginas.emptyTitle')}</p>
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
                    dragDisabled={reordering}
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
          <DocSkeleton />
        ) : (
          <PageEditorPane
            // `clienteId` entra na key como segunda camada -- `PagesEditor` já é
            // remontado por inteiro ao trocar de cliente (key acima, em PaginasPage),
            // mas isto não depende de lembrar de manter os dois sincronizados se algum
            // dia `PageEditorPane` passar a ser usado sem esse ancestral.
            key={`${clienteId}:${selectedId ?? `new-${newDraftNonce}`}`}
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
            <AlertDialogTitle>{t('paginas.switchTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('paginas.unsavedMessage')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('paginas.keepEditing')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSwitch}>
              {t('paginas.switchAnyway')}
            </AlertDialogAction>
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
  variant = 'desktop',
  onClose,
}: {
  clienteId: number;
  contaId: string;
  page: HubPageRow | null;
  onSaved: (wasCreate: boolean) => void;
  onDeleted: () => void;
  onDirtyChange: (dirty: boolean) => void;
  /** `phone`: a pushed screen with its own nav bar; Back is `onClose`. */
  variant?: 'desktop' | 'phone';
  onClose?: () => void;
}) {
  const { t } = useTranslation('clientHub');
  const loaded = useMemo(() => readPageDocResult(page?.content), [page?.content]);
  const legacy = useMemo(() => isLegacyContent(page?.content), [page?.content]);
  // Página nova (`page === null`) ainda não tem id -- sem uma chave própria,
  // `usePageDraft(null)` vira no-op e tudo que for digitado em "Nova página" some ao
  // trocar de página (Finding 3). A chave é escopada por cliente (não por sessão) para
  // sobreviver a trocar de aba e voltar, e `handleSave` chama `clearDraft()` no sucesso da
  // criação para não deixar esse rascunho "novo" reaparecer numa composição futura.
  const draftKey = page?.id ?? `new-${clienteId}`;
  const { draft, saveDraft, clearDraft } = usePageDraft(draftKey);

  // `draft?.title` é `undefined` tanto para "sem rascunho" quanto para um rascunho
  // gravado no formato antigo (doc-only, sem título) -- os dois casos devem cair
  // pro título do servidor, não pra string vazia.
  const [title, setTitle] = useState(draft?.title ?? page?.title ?? '');
  const [doc, setDoc] = useState<Record<string, unknown>>(draft?.doc ?? loaded.doc);
  const [saving, setSaving] = useState(false);
  // `draft` já existia no localStorage quando este painel montou -- fixado uma única
  // vez (não recalculado a cada render) para orientar o aviso "Rascunho restaurado"
  // abaixo. Continua `true` mesmo depois de `draft` (memoizado em `draftKey`, estável
  // durante a vida desta instância -- ver key do painel em PagesEditor) já ter sido
  // limpo do storage; quem decide se o aviso some é `discardedDraft`, não este valor.
  const [hadStoredDraft] = useState(draft != null);
  const [discardedDraft, setDiscardedDraft] = useState(false);
  // Bump força `PaginaRichTextEditor` a remontar com um `doc` novo -- `useEditor`
  // congela `content` no primeiro mount (ver PaginaRichTextEditor.tsx), então trocar
  // o estado `doc` sozinho (como faz "Descartar rascunho") não é visto pelo
  // ProseMirror já em pé.
  const [editorResetNonce, setEditorResetNonce] = useState(0);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);

  const docRef = useRef(doc);
  docRef.current = doc;
  const titleRef = useRef(title);
  titleRef.current = title;
  const draftTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // A MESMA função `saveDraft` que `scheduleDraftSave` fechou ao agendar o debounce
  // pendente -- nunca a mais recente. `draftKey` (e por tabela a identidade de
  // `saveDraft`, vinda de `usePageDraft`) muda sempre que a prop `page` muda, e isso
  // acontece SEM desmontar este componente: excluir a página faz `currentPage` virar
  // `null` num re-render antes do `key` do painel (lá em cima, em `selectedId`) ser
  // atualizado, então este mesmo componente segue vivo com `draftKey` agora apontando
  // pra `new-<clienteId>`. Se o flush de desmontagem dependesse de `saveDraft` "atual"
  // (como antes), ele gravaria o rascunho pendente sob a chave ERRADA -- a de "Nova
  // página" -- em vez da chave sob a qual foi agendado (Finding 2, fix round 3).
  const pendingSaveRef = useRef<typeof saveDraft | null>(null);

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

  // Ao desmontar (troca de página confirmada, remount por `newDraftNonce`, ou sair da
  // aba) com um debounce pendente, GRAVA o rascunho antes de cancelar o timer -- só
  // cancelar (como antes) perdia o título/corpo mais recentes sempre que a troca
  // acontecia dentro da janela de 400ms, contradizendo o diálogo de confirmação, que
  // promete que as alterações ficam guardadas no navegador (Finding 2).
  //
  // Deps `[]` de propósito (fix round 3): `saveDraft` muda de identidade toda vez que
  // `draftKey` muda, o que acontece a cada re-render em que a prop `page` muda -- não
  // só ao desmontar de verdade. Depender de `[saveDraft]` reexecutava esta limpeza a
  // cada troca de página/prop, cada vez chamando a versão de `saveDraft` do momento em
  // vez da que estava em vigor quando o debounce foi agendado -- gravando o rascunho
  // pendente sob a chave ERRADA. `pendingSaveRef` (atualizado só em
  // `scheduleDraftSave`, nunca em todo render) fixa o alvo correto, e a limpeza roda
  // uma única vez, no desmonte de verdade.
  useEffect(
    () => () => {
      if (draftTimeoutRef.current) {
        clearTimeout(draftTimeoutRef.current);
        draftTimeoutRef.current = undefined;
        pendingSaveRef.current?.(titleRef.current, docRef.current);
      }
    },
    [],
  );

  // Grava o rascunho (título + doc, sempre os dois juntos) com um pequeno debounce
  // -- uma página grande gera um JSON grande, e regravar o localStorage a cada
  // tecla pode travar a digitação. Título e corpo compartilham o MESMO debounce:
  // gravar cada um separado é o que produzia o par título/corpo incoerente do
  // Finding 1 (editar os dois, trocar de página, e o corpo voltar do rascunho
  // enquanto o título voltava do servidor).
  function scheduleDraftSave() {
    if (draftTimeoutRef.current) clearTimeout(draftTimeoutRef.current);
    pendingSaveRef.current = saveDraft;
    draftTimeoutRef.current = setTimeout(() => {
      // Zera ANTES de gravar, não depois de agendar: sem isto, `draftTimeoutRef.current`
      // ficava com o id do timer já disparado para sempre (só era limpo em
      // `handleSave`), então o flush de desmontagem acima achava que havia um debounce
      // PENDENTE muito depois de ele já ter gravado -- a causa raiz do Finding 2 (fix
      // round 3): editar uma página e excluí-la ressuscitava o rascunho já apagado por
      // `clearDraft()`, e ainda vazava o conteúdo apagado para o rascunho de "Nova
      // página" do mesmo cliente.
      draftTimeoutRef.current = undefined;
      saveDraft(titleRef.current, docRef.current);
    }, 400);
  }

  function handleEditorChange(next: Record<string, unknown>) {
    setDoc(next);
    scheduleDraftSave();
  }

  function handleTitleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setTitle(e.target.value);
    scheduleDraftSave();
  }

  // Volta para a versão do servidor e apaga o rascunho local -- a única saída de um
  // rascunho restaurado que ninguém mais consegue enxergar (spec: "aviso... e opção de
  // descartar"). Sem isto, um rascunho de um dispositivo mais antigo esconde
  // permanentemente uma versão mais nova salva por outra pessoa: reabrir a página
  // sempre reidrata o rascunho local, e "Salvar" sobrescreveria o trabalho alheio.
  function handleDiscardDraft() {
    if (draftTimeoutRef.current) {
      clearTimeout(draftTimeoutRef.current);
      draftTimeoutRef.current = undefined;
      pendingSaveRef.current = null;
    }
    clearDraft();
    setTitle(page?.title ?? '');
    setDoc(loaded.doc);
    // Remonta o ProseMirror com o doc do servidor -- só trocar `doc` não bastaria
    // (useEditor congela `content` no primeiro mount).
    setEditorResetNonce((n) => n + 1);
    setDiscardedDraft(true);
  }

  async function handleSave() {
    if (!title.trim()) {
      toast.error(t('paginas.titleRequired'));
      return;
    }
    if (draftTimeoutRef.current) {
      clearTimeout(draftTimeoutRef.current);
      draftTimeoutRef.current = undefined;
      pendingSaveRef.current = null;
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
      toast.success(t('paginas.saved'));
      onSaved(wasCreate);
    } catch (e: any) {
      toast.error(e?.message ?? t('paginas.saveError'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(confirmed = false) {
    if (!page) return;
    if (!confirmed && !window.confirm(t('paginas.confirmDelete'))) return;
    // Cancela qualquer debounce pendente ANTES de excluir -- sem isto, um
    // `scheduleDraftSave` dos últimos 400ms ainda dispararia depois do
    // `clearDraft()` abaixo, ressuscitando o rascunho da página que acabou de ser
    // apagada (Finding 2, fix round 3).
    if (draftTimeoutRef.current) {
      clearTimeout(draftTimeoutRef.current);
      draftTimeoutRef.current = undefined;
      pendingSaveRef.current = null;
    }
    try {
      await removeHubPage(page.id);
      clearDraft();
      toast.success(t('paginas.removed'));
      onDeleted();
    } catch (e: any) {
      toast.error(e?.message ?? t('paginas.removeError'));
    }
  }

  const notes = (
    <>
      {legacy && <p className="hub-paginas__legacy-note">{t('paginas.legacyNote')}</p>}
      {!loaded.converted && (
        <p className="hub-paginas__legacy-note hub-paginas__legacy-note--warn">
          {t('paginas.conversionWarning')}
        </p>
      )}
      {hadStoredDraft && !discardedDraft && (
        <p className="hub-paginas__legacy-note hub-paginas__legacy-note--warn hub-paginas__draft-notice">
          <span>{t('paginas.draftRestored')}</span>
          <button type="button" className="hub-paginas__discard-draft" onClick={handleDiscardDraft}>
            {t('paginas.discardDraft')}
          </button>
        </p>
      )}
    </>
  );

  if (variant === 'phone') {
    // Back with unsaved changes asks first (the draft stays in this browser either way,
    // as the desktop page-switch dialog says); the system Back gesture closes directly,
    // the draft flush on unmount keeps what was typed.
    const requestBack = () => (isDirty ? setConfirmLeaveOpen(true) : onClose?.());
    return (
      <div className="phone-cli-pagina">
        <PhoneNavBar
          backLabel={t('paginas.backToPages')}
          onBack={requestBack}
          trailing={
            <button
              type="button"
              className="phone-cli-cal__step"
              disabled={saving}
              onClick={() => void handleSave()}
            >
              {t('actions.save')}
            </button>
          }
        />
        <header className="phone-kit phone-large-title phone-cli-title">
          <h1 className="phone-large-title__title">{page?.title || t('paginas.newPage')}</h1>
          <p className="phone-large-title__subtitle">
            {isDirty ? t('paginas.unsaved') : t('paginas.portalPage')}
          </p>
        </header>
        {notes}
        <GroupedList aria-label={t('paginas.titleAria')}>
          <FormRow
            label={t('paginas.titleLabel')}
            layout="stacked"
            input={{
              value: title,
              onChange: handleTitleChange,
              placeholder: t('paginas.titlePlaceholder'),
            }}
          />
        </GroupedList>
        <h2 className="phone-group__header">{t('paginas.content')}</h2>
        <PaginaRichTextEditor
          key={editorResetNonce}
          doc={doc}
          onChange={handleEditorChange}
          variant="phone"
        />
        {page && (
          <GroupedList aria-label={t('paginas.removePage')} className="phone-cli-pagina__danger">
            <Cell
              label={t('paginas.removePage')}
              icon={<Trash2 />}
              destructive
              onClick={() => setConfirmDeleteOpen(true)}
            />
          </GroupedList>
        )}
        <PhoneConfirmSheet
          open={confirmDeleteOpen}
          title={t('paginas.removeTitle')}
          message={t('paginas.removeMessage')}
          actions={[
            {
              label: t('actions.delete'),
              destructive: true,
              onSelect: () => {
                setConfirmDeleteOpen(false);
                void handleDelete(true);
              },
            },
          ]}
          onCancel={() => setConfirmDeleteOpen(false)}
        />
        <PhoneConfirmSheet
          open={confirmLeaveOpen}
          title={t('paginas.leaveTitle')}
          message={t('paginas.unsavedMessage')}
          actions={[
            {
              label: t('paginas.leaveAnyway'),
              onSelect: () => {
                setConfirmLeaveOpen(false);
                onClose?.();
              },
            },
          ]}
          cancelLabel={t('paginas.keepEditing')}
          onCancel={() => setConfirmLeaveOpen(false)}
        />
      </div>
    );
  }

  return (
    <div className="hub-paginas__editor">
      {notes}

      <div className="hub-paginas__toolbar-row">
        <Input
          value={title}
          onChange={handleTitleChange}
          placeholder={t('paginas.titlePlaceholder')}
          className="hub-paginas__title-input"
        />
        <div className="hub-paginas__toolbar-actions">
          {isDirty && <span className="hub-paginas__dirty-badge">{t('paginas.unsaved')}</span>}
          {page && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void handleDelete()}
              aria-label={t('paginas.removePage')}
            >
              <Trash2 size={14} />
            </Button>
          )}
          <Button size="sm" onClick={handleSave} disabled={saving}>
            <Save size={14} className="mr-1.5" /> {t('actions.save')}
          </Button>
        </div>
      </div>

      <PaginaRichTextEditor key={editorResetNonce} doc={doc} onChange={handleEditorChange} />
    </div>
  );
}
