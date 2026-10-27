import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowDownUp,
  ExternalLink,
  GripVertical,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { trackUnsavedWork } from '@mesaas/app-lifecycle';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useStatusRegistry } from '@/hooks/useStatusRegistry';
import { entitlementMessage, mapEntitlementError } from '@/lib/entitlement-errors';
import {
  addItem,
  deleteItem,
  linhaPostsKey,
  listPostsDaLinha,
  reorderItens,
  updateItem,
  type LinhaColuna,
  type LinhaEditorial,
  type LinhaItem,
  type LinhaItemPatch,
  type LinhaPost,
  type LinhaResposta,
} from '@/store/linhaEditorial';
import { getMembros, type Membro } from '@/store/team';
import { PostStatusChip } from '../components/PostStatusChip';
import type { StatusRegistry } from '../statusRegistry';
import { FormatoPill } from './FormatoPill';
import { LinhaAprovacaoChip } from './LinhaAprovacaoChip';
import {
  DateCell,
  FormatoCell,
  TextCell,
  ValorCell,
  ValorDisplay,
  formatDia,
  type CellNav,
} from './LinhaCell';
import { defaultNovaData, mensagemGuardItem } from './linhaLogic';
import { linhaItensKey, linhasKey } from './useLinhaQueries';

export interface LinhaTableProps {
  linha: LinhaEditorial;
  itens: LinhaItem[];
  colunas: LinhaColuna[];
  respostas: LinhaResposta[];
  /** Selected rows (unconverted only). The state lives in the view, for the selection bar. */
  selectedIds: string[];
  onSelect: (ids: string[]) => void;
  /** "Direção do conteúdo" hidden in this browser (`entregasPrefs`). */
  direcaoOculta?: boolean;
  /** Opens the comments panel on a row's thread, or on the linha-level thread with null. */
  onOpenComentarios?: (itemId: string | null) => void;
}

const MSG_SALVAR = 'Não foi possível salvar a alteração. Tente de novo.';

/** Plan limits first, then the row guard's raises, then the caller's fallback. */
function erroDe(err: unknown, fallback: string): string {
  const ent = mapEntitlementError(err);
  if (ent) return entitlementMessage(ent);
  return mensagemGuardItem(err) ?? fallback;
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/**
 * Optimistic writes on the items cache (`linhaItensKey`). Each write updates the cache first,
 * then runs inside `trackUnsavedWork`; a failure refetches the list and toasts. Only the fields
 * being changed travel to PostgREST (`post_id` and the conversion columns are not granted).
 */
function useItemWrites(linha: LinhaEditorial, itens: LinhaItem[]) {
  const qc = useQueryClient();
  const key = linhaItensKey(linha.id);
  /** Rows whose insert is still in flight: a patch or delete on them waits for the insert. */
  const inserting = useRef(new Map<string, Promise<unknown>>());
  /** Rollback refetches (after a failed write) still in flight. */
  const rollbacks = useRef(0);

  const atuais = () => qc.getQueryData<LinhaItem[]>(key) ?? itens;
  /**
   * Applies an optimistic change. A plain refetch in flight is cancelled so it can't overwrite
   * the change; a rollback refetch is left alone (cancelling it would keep the failed write on
   * screen), and the write reports `true` so it resyncs once it lands.
   */
  const setItens = (fn: (l: LinhaItem[]) => LinhaItem[]): boolean => {
    const duranteRollback = rollbacks.current > 0;
    if (!duranteRollback) void qc.cancelQueries({ queryKey: key });
    qc.setQueryData<LinhaItem[]>(key, (old) => fn(old ?? itens));
    return duranteRollback;
  };
  const ressincronizar = (duranteRollback: boolean) => () => {
    if (duranteRollback) void qc.invalidateQueries({ queryKey: key });
  };
  const falhou = (fallback: string) => (err: unknown) => {
    rollbacks.current++;
    void qc.invalidateQueries({ queryKey: key }).finally(() => rollbacks.current--);
    toast.error(erroDe(err, fallback));
  };
  const contarNoRail = () => void qc.invalidateQueries({ queryKey: linhasKey(linha.periodo) });

  /** Runs `run` now, or after the row's in-flight insert; a failed insert skips it. */
  const depoisDoInsert = <T,>(id: string, run: () => Promise<T>) => {
    const antes = inserting.current.get(id);
    // A failed insert already toasted and refetched: the row is gone, nothing to write.
    return trackUnsavedWork(antes ? antes.then(run, () => undefined) : run());
  };

  const patch = (id: string, p: LinhaItemPatch) => {
    const durante = setItens((l) => l.map((i) => (i.id === id ? { ...i, ...p } : i)));
    void depoisDoInsert(id, () => updateItem(id, p))
      .then(ressincronizar(durante))
      .catch(falhou(MSG_SALVAR));
  };

  /** Writes one extra column's value; the whole `valores` object travels (JSONB column). */
  const patchValor = (id: string, colunaId: string, v: unknown) => {
    const atual = atuais().find((i) => i.id === id);
    const valores = { ...(atual?.valores ?? {}) };
    if (v == null) delete valores[colunaId];
    else valores[colunaId] = v;
    patch(id, { valores });
  };

  const add = (): string => {
    const lista = atuais();
    const id = crypto.randomUUID();
    const data = defaultNovaData(lista, linha.periodo);
    const ordem = lista.reduce((m, i) => Math.max(m, i.ordem), -1) + 1;
    const novo: LinhaItem = {
      id,
      linha_id: linha.id,
      data,
      tipo: 'feed',
      titulo: '',
      direcao: '',
      valores: {},
      ordem,
      post_id: null,
    };
    const durante = setItens((l) => [...l, novo]);
    const insert = trackUnsavedWork(addItem(linha.id, { id, data, tipo: 'feed', ordem }));
    inserting.current.set(id, insert);
    void insert
      .then(() => {
        contarNoRail();
        ressincronizar(durante)();
      }, falhou('Não foi possível criar a linha. Tente de novo.'))
      .finally(() => inserting.current.delete(id));
    return id;
  };

  const remove = (id: string) => {
    const durante = setItens((l) => l.filter((i) => i.id !== id));
    void depoisDoInsert(id, () => deleteItem(id))
      .then(() => {
        contarNoRail();
        ressincronizar(durante)();
      })
      .catch(falhou('Não foi possível excluir a linha. Tente de novo.'));
  };

  const reorder = (ids: string[]) => {
    const durante = setItens((l) => {
      const byId = new Map(l.map((i) => [i.id, i]));
      return ids.flatMap((id, ordem) => {
        const i = byId.get(id);
        return i ? [{ ...i, ordem }] : [];
      });
    });
    void trackUnsavedWork(reorderItens(ids))
      .then(ressincronizar(durante))
      .catch(falhou('Não foi possível reordenar. Tente de novo.'));
  };

  return { patch, patchValor, add, remove, reorder };
}

/** Focusable cells in DOM order, for Tab; same column further down, for Enter. */
function moverFoco(e: KeyboardEvent<HTMLTableElement>) {
  const el = e.target as HTMLElement;
  if (!el.hasAttribute('data-linha-nav') || e.defaultPrevented) return;
  if (e.nativeEvent.isComposing || e.altKey || e.metaKey || e.ctrlKey) return;
  const all = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-linha-nav]'));
  const idx = all.indexOf(el);
  let next: HTMLElement | undefined;
  if (e.key === 'Tab') {
    next = all[e.shiftKey ? idx - 1 : idx + 1];
  } else if (e.key === 'Enter' && !e.shiftKey) {
    const col = el.getAttribute('data-col');
    next = all.slice(idx + 1).find((c) => c.getAttribute('data-col') === col);
    // Enter in a text cell never does anything else (no form submit), so swallow it at the
    // last row too; Shift+Enter keeps its newline in Direção.
    if (!next && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
      e.preventDefault();
    }
  }
  if (!next) return;
  e.preventDefault();
  next.focus();
  if (next instanceof HTMLInputElement && (next.type === 'text' || next.type === 'url')) {
    next.select();
  }
}

interface RowProps {
  item: LinhaItem;
  index: number;
  extras: LinhaColuna[];
  direcaoOculta: boolean;
  temProducao: boolean;
  post: LinhaPost | undefined;
  registry: StatusRegistry;
  postHref: string | null;
  membros: Membro[];
  selected: boolean;
  comentarios: number;
  /** The linha's `rodada`: the approval chip shows once it was sent. */
  rodada: number;
  writes: ReturnType<typeof useItemWrites>;
  onToggle: (on: boolean) => void;
  onOpenComentarios?: (itemId: string) => void;
  onExcluir: () => void;
  onAbrirPost: () => void;
}

function LinhaRow({
  item,
  index,
  extras,
  direcaoOculta,
  temProducao,
  post,
  registry,
  postHref,
  membros,
  selected,
  comentarios,
  rodada,
  writes,
  onToggle,
  onOpenComentarios,
  onExcluir,
  onAbrirPost,
}: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const convertido = item.post_id != null;
  const nome = item.titulo.trim() || 'sem título';
  const nav = (col: string): CellNav => ({ row: index, col });

  return (
    <tr
      ref={setNodeRef}
      className={`linha-row${convertido ? ' is-convertido' : ''}${selected ? ' is-selected' : ''}`}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : undefined,
      }}
      data-item-id={item.id}
      data-testid={`linha-row-${item.id}`}
    >
      <td className="linha-td linha-td--handle">
        <button
          type="button"
          className="linha-drag"
          aria-label={`Reordenar ${nome}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      </td>
      <td className="linha-td linha-td--check">
        {!convertido && (
          <input
            type="checkbox"
            className="linha-check"
            aria-label={`Selecionar ${nome}`}
            checked={selected}
            onChange={(e) => onToggle(e.target.checked)}
          />
        )}
      </td>
      <td className="linha-td linha-td--data">
        {convertido ? (
          <span>{formatDia(item.data) || 'Sem data'}</span>
        ) : (
          <DateCell
            value={item.data}
            label="Data"
            nav={nav('data')}
            onSave={(data) => writes.patch(item.id, { data })}
          />
        )}
      </td>
      <td className="linha-td linha-td--formato">
        {convertido ? (
          <FormatoPill tipo={item.tipo} />
        ) : (
          <FormatoCell
            value={item.tipo}
            nav={nav('formato')}
            onSave={(tipo) => writes.patch(item.id, { tipo })}
          />
        )}
      </td>
      <td className="linha-td linha-td--titulo">
        <span className="linha-titulo">
          {convertido ? (
            <span className="linha-text">{item.titulo}</span>
          ) : (
            <TextCell
              value={item.titulo}
              label="Título"
              placeholder="Sobre o que é o post"
              nav={nav('titulo')}
              onSave={(titulo) => writes.patch(item.id, { titulo })}
            />
          )}
          <LinhaAprovacaoChip item={item} rodada={rodada} onOpenComentarios={onOpenComentarios} />
        </span>
      </td>
      {!direcaoOculta && (
        <td className="linha-td linha-td--direcao">
          {convertido ? (
            <span className="linha-text linha-text--multi">{item.direcao}</span>
          ) : (
            <TextCell
              multiline
              value={item.direcao}
              label="Direção do conteúdo"
              placeholder="Gancho, roteiro, referência visual"
              nav={nav('direcao')}
              onSave={(direcao) => writes.patch(item.id, { direcao })}
            />
          )}
        </td>
      )}
      {extras.map((col) => (
        <td key={col.id} className="linha-td linha-td--extra">
          {convertido ? (
            <ValorDisplay coluna={col} value={item.valores[col.id]} membros={membros} />
          ) : (
            <ValorCell
              coluna={col}
              value={item.valores[col.id]}
              membros={membros}
              nav={nav(`c:${col.id}`)}
              onSave={(v) => writes.patchValor(item.id, col.id, v)}
            />
          )}
        </td>
      ))}
      {temProducao && (
        <td className="linha-td linha-td--producao">
          {convertido &&
            (post ? (
              <span className="linha-producao">
                <PostStatusChip post={post} registry={registry} />
                {postHref && (
                  <Link to={postHref} className="linha-link">
                    {post.workflow_titulo ?? 'Post avulso'}
                  </Link>
                )}
              </span>
            ) : (
              <span className="linha-vazio">Post criado</span>
            ))}
        </td>
      )}
      <td className="linha-td linha-td--acoes">
        <span className="linha-acoes">
          {comentarios > 0 && (
            <button
              type="button"
              className="linha-bubble"
              aria-label={plural(comentarios, 'comentário', 'comentários')}
              onClick={() => onOpenComentarios?.(item.id)}
            >
              <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
              {comentarios}
            </button>
          )}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="linha-icon-btn"
                aria-label={`Ações da linha ${nome}`}
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {convertido && (
                <>
                  <DropdownMenuItem disabled={!postHref} onSelect={onAbrirPost}>
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Abrir post
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem className="text-destructive" onSelect={onExcluir}>
                <Trash2 className="mr-2 h-4 w-4" />
                Excluir linha
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </td>
    </tr>
  );
}

export function LinhaTable({
  linha,
  itens,
  colunas,
  respostas,
  selectedIds,
  onSelect,
  direcaoOculta = false,
  onOpenComentarios,
}: LinhaTableProps) {
  const qc = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const writes = useItemWrites(linha, itens);
  const registry = useStatusRegistry();
  const tableRef = useRef<HTMLTableElement>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [excluindo, setExcluindo] = useState<LinhaItem | null>(null);

  const rows = useMemo(() => [...itens].sort((a, b) => a.ordem - b.ordem), [itens]);
  const extras = useMemo(
    () => colunas.filter((c) => !c.oculta).sort((a, b) => a.ordem - b.ordem),
    [colunas],
  );
  const temProducao = rows.some((i) => i.post_id != null);
  const selecionaveis = rows.filter((i) => i.post_id == null).map((i) => i.id);
  const selected = new Set(selectedIds);
  const todas = selecionaveis.length > 0 && selecionaveis.every((id) => selected.has(id));
  const algumas = !todas && selecionaveis.some((id) => selected.has(id));

  // Production state of converted rows. The key carries only the linha (Tasks 10 and 11
  // invalidate it after converting); a change in the set of post ids refetches it too.
  const postIds = useMemo(
    () =>
      rows
        .map((i) => i.post_id)
        .filter((id): id is number => id != null)
        .sort((a, b) => a - b),
    [rows],
  );
  const postsSig = postIds.join(',');
  const { data: posts } = useQuery({
    queryKey: linhaPostsKey(linha.id),
    queryFn: () => listPostsDaLinha(postIds),
    enabled: postIds.length > 0,
  });
  const lastSig = useRef(postsSig);
  useEffect(() => {
    if (lastSig.current === postsSig) return;
    lastSig.current = postsSig;
    if (postsSig) void qc.invalidateQueries({ queryKey: linhaPostsKey(linha.id) });
  }, [postsSig, qc, linha.id]);
  const postById = useMemo(() => new Map((posts ?? []).map((p) => [p.id, p])), [posts]);

  const { data: membros = [] } = useQuery({
    queryKey: ['membros'],
    queryFn: getMembros,
    enabled: extras.some((c) => c.tipo === 'person'),
  });

  const comentariosPorItem = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of respostas) {
      if (r.item_id && r.comentario?.trim()) map.set(r.item_id, (map.get(r.item_id) ?? 0) + 1);
    }
    return map;
  }, [respostas]);
  const comentariosGerais = respostas.filter((r) => !r.item_id && r.comentario?.trim()).length;

  const postHref = (postId: number | null) => {
    if (postId == null) return null;
    const params = new URLSearchParams(location.search);
    params.set('post', String(postId));
    return `${location.pathname}?${params.toString()}`;
  };

  // Focus the new row's Título once it is in the table.
  useEffect(() => {
    if (!focusId) return;
    const el = tableRef.current?.querySelector<HTMLElement>(
      `[data-item-id="${focusId}"] [data-col="titulo"]`,
    );
    if (el) {
      el.focus();
      setFocusId(null);
    }
  }, [focusId, rows]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const ids = rows.map((i) => i.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    writes.reorder(arrayMove(ids, from, to));
  };

  const ordenarPorData = () => {
    const ids = [...rows]
      .sort((a, b) => {
        const da = a.data ?? '9999-99-99';
        const db = b.data ?? '9999-99-99';
        return da === db ? a.ordem - b.ordem : da < db ? -1 : 1;
      })
      .map((i) => i.id);
    if (ids.every((id, idx) => id === rows[idx].id)) return;
    writes.reorder(ids);
  };

  const excluir = (item: LinhaItem) => {
    if (item.post_id != null) {
      setExcluindo(item);
      return;
    }
    if (selected.has(item.id)) onSelect(selectedIds.filter((id) => id !== item.id));
    writes.remove(item.id);
  };

  const colCount = 6 + (direcaoOculta ? 0 : 1) + extras.length + (temProducao ? 1 : 0);

  return (
    <div className="linha-table-area">
      <div className="linha-toolbar">
        <button
          type="button"
          className="linha-btn"
          onClick={ordenarPorData}
          disabled={!rows.length}
        >
          <ArrowDownUp className="h-4 w-4" />
          Ordenar por data
        </button>
        <button type="button" className="linha-btn" onClick={() => onOpenComentarios?.(null)}>
          <MessageSquare className="h-4 w-4" />
          Comentários gerais
          {comentariosGerais > 0 && <span className="linha-count">{comentariosGerais}</span>}
        </button>
      </div>
      <div className="linha-table-wrap">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <table ref={tableRef} className="linha-table" onKeyDown={moverFoco}>
            <thead>
              <tr>
                <th className="linha-th linha-td--handle" aria-label="Ordem" />
                <th className="linha-th linha-td--check">
                  <input
                    type="checkbox"
                    className="linha-check"
                    aria-label="Selecionar todas"
                    checked={todas}
                    disabled={selecionaveis.length === 0}
                    ref={(el) => {
                      if (el) el.indeterminate = algumas;
                    }}
                    onChange={() => onSelect(todas ? [] : selecionaveis)}
                  />
                </th>
                <th className="linha-th linha-td--data">Data</th>
                <th className="linha-th linha-td--formato">Formato</th>
                <th className="linha-th linha-td--titulo">Título</th>
                {!direcaoOculta && (
                  <th className="linha-th linha-td--direcao">Direção do conteúdo</th>
                )}
                {extras.map((c) => (
                  <th key={c.id} className="linha-th linha-td--extra">
                    {c.nome}
                  </th>
                ))}
                {temProducao && <th className="linha-th linha-td--producao">Produção</th>}
                <th className="linha-th linha-td--acoes" aria-label="Ações" />
              </tr>
            </thead>
            <tbody>
              <SortableContext items={rows.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                {rows.map((item, index) => (
                  <LinhaRow
                    key={item.id}
                    item={item}
                    index={index}
                    extras={extras}
                    direcaoOculta={direcaoOculta}
                    temProducao={temProducao}
                    post={item.post_id != null ? postById.get(item.post_id) : undefined}
                    registry={registry}
                    postHref={postHref(item.post_id)}
                    membros={membros}
                    selected={selected.has(item.id)}
                    comentarios={comentariosPorItem.get(item.id) ?? 0}
                    rodada={linha.rodada}
                    writes={writes}
                    onToggle={(on) =>
                      onSelect(
                        on
                          ? [...selectedIds.filter((id) => id !== item.id), item.id]
                          : selectedIds.filter((id) => id !== item.id),
                      )
                    }
                    onOpenComentarios={onOpenComentarios}
                    onExcluir={() => excluir(item)}
                    onAbrirPost={() => {
                      const href = postHref(item.post_id);
                      if (href) navigate(href);
                    }}
                  />
                ))}
              </SortableContext>
              {rows.length === 0 && (
                <tr>
                  <td className="linha-td linha-td--vazio" colSpan={colCount}>
                    Nenhum post ainda. Comece com Nova linha.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </DndContext>
      </div>
      <button type="button" className="linha-nova" onClick={() => setFocusId(writes.add())}>
        <Plus className="h-4 w-4" />
        Nova linha
      </button>

      <AlertDialog open={!!excluindo} onOpenChange={(open) => !open && setExcluindo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir linha</AlertDialogTitle>
            <AlertDialogDescription>
              Excluir esta linha? O post criado a partir dela continua existindo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (excluindo) writes.remove(excluindo.id);
                setExcluindo(null);
              }}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
