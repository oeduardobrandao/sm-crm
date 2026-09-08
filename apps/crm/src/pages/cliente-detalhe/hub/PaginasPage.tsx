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

/** Chave compartilhada entre a query de `PaginasPage` e o resync direto que
 *  `PagesEditor` faz no cache depois de uma reordenação (ver handleDragEnd) --
 *  as duas têm que apontar pra a MESMA entrada do cache. */
function hubPagesQueryKey(clienteId: number) {
  return ['hub-pages-crm', clienteId] as const;
}

export default function PaginasPage() {
  const { clienteId, cliente } = useOutletContext<ClienteDetalheOutletContext>();
  const qc = useQueryClient();
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
  const qc = useQueryClient();
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
      toast.error('Erro ao reordenar páginas.');
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
          <div className="py-8 flex justify-center">
            <Spinner size="md" />
          </div>
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
      toast.error('Dê um título para a página.');
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
      {hadStoredDraft && !discardedDraft && (
        <p className="hub-paginas__legacy-note hub-paginas__legacy-note--warn hub-paginas__draft-notice">
          <span>
            Rascunho restaurado neste navegador. Pode haver uma versão mais recente salva por outra
            pessoa.
          </span>
          <button type="button" className="hub-paginas__discard-draft" onClick={handleDiscardDraft}>
            Descartar rascunho
          </button>
        </p>
      )}

      <div className="hub-paginas__toolbar-row">
        <Input
          value={title}
          onChange={handleTitleChange}
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

      <PaginaRichTextEditor key={editorResetNonce} doc={doc} onChange={handleEditorChange} />
    </div>
  );
}
