import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useIntlLocale } from '@mesaas/i18n';
import {
  ArrowLeft,
  Ban,
  CalendarDays,
  History,
  Pause,
  Pencil,
  Play,
  Plus,
  Repeat,
  Trash2,
  User2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PessoaAvatar } from '@/components/PessoaAvatar';
import { usePhoneLayout } from '@/components/layout/PhoneLayoutContext';
import {
  addSubtarefa,
  definirEstadoSerie,
  deleteSubtarefa,
  deleteTarefa,
  deleteTarefaSerieCompleta,
  getSubtarefas,
  toggleSubtarefa,
  updateTarefa,
  type Membro,
  type TarefaWithRelations,
} from '../../../store';
import { dueBadge, parseDateOnly, STATUS_LABELS, STATUS_ORDER } from '../tarefasLogic';
import { describeRecorrencia, modoLabel, serieEstado, serieEstadoLabel } from '../recorrenciaLogic';
import { TagPill } from './TagPicker';
import { TarefaDescriptionContent } from './TarefaDescriptionContent';
import { TarefaDetailPhone } from '../phone/TarefaDetailPhone';
import { TarefaComentarios } from './TarefaComentarios';
import { TarefaHistoryPanel, tarefaEventosKey } from './TarefaHistoryPanel';

type SheetView = 'detalhe' | 'historico';

interface SheetNav {
  tarefaId: number | undefined;
  view: SheetView;
  /** The deep link's comment focus already happened (or the user moved on): never again. */
  focusSpent: boolean;
}

interface TarefaDetailSheetProps {
  /** Defaults to true. On phones the page keeps the sheet mounted and toggles this, so
   *  the pushed screen can pop its own history entry when it closes. */
  open?: boolean;
  tarefa: TarefaWithRelations;
  membros: Membro[];
  onClose: () => void;
  onEdit: () => void;
  onRefresh: () => void;
  /** Deep link `&comentarios=1` (desktop only): scroll to the comments and focus the composer,
   *  once per opened task. */
  focusComments?: boolean;
}

export function TarefaDetailSheet({
  open = true,
  tarefa,
  membros,
  onClose,
  onEdit,
  onRefresh: onRefreshList,
  focusComments = false,
}: TarefaDetailSheetProps) {
  // Same gate as the dialog primitives (F0c): the phone layout only inside the phone
  // shell, so suites that render the sheet alone keep the desktop markup.
  const { isPhone } = usePhoneLayout();
  const { t } = useTranslation('tasksForm');
  const intlLocale = useIntlLocale();
  const queryClient = useQueryClient();
  const [newSubtarefa, setNewSubtarefa] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const now = new Date();

  // Body view, reset whenever another task is shown in the same mounted sheet.
  const [navState, setNavState] = useState<SheetNav>({
    tarefaId: tarefa.id,
    view: 'detalhe',
    focusSpent: false,
  });
  const nav: SheetNav =
    navState.tarefaId === tarefa.id
      ? navState
      : { tarefaId: tarefa.id, view: 'detalhe', focusSpent: false };
  const view = nav.view;
  // Leaving the details unmounts the comments; coming back must not refocus them.
  const setView = (next: SheetView) =>
    setNavState({ tarefaId: tarefa.id, view: next, focusSpent: nav.focusSpent || focusComments });
  const autoFocusComments = focusComments && !nav.focusSpent;

  /** Every local change also lands in the history, so its cached query goes stale too. */
  const onRefresh = () => {
    void queryClient.invalidateQueries({ queryKey: tarefaEventosKey(tarefa.id!) });
    onRefreshList();
  };

  const { data: subtarefas = [] } = useQuery({
    queryKey: ['subtarefas', tarefa.id],
    queryFn: () => getSubtarefas(tarefa.id!),
  });

  const refreshSubtarefas = () => {
    queryClient.invalidateQueries({ queryKey: ['subtarefas', tarefa.id] });
    onRefresh(); // subtask counters on cards come from ['tarefas']
  };

  const membro = membros.find((m) => m.id === tarefa.responsavel_id) ?? null;
  const badge = dueBadge(tarefa, now);
  const [confirmEncerrar, setConfirmEncerrar] = useState(false);
  const [serieBusy, setSerieBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  // Ref guard too: state alone would let two clicks in the same tick both through.
  const deleteInFlight = useRef(false);
  const serie = tarefa.serie;
  const estado = serie ? serieEstado(serie, now) : null;
  const estadoLabel = serie ? serieEstadoLabel(serie, now) : null;

  const handleStatusChange = async (status: TarefaWithRelations['status']) => {
    if (status === tarefa.status) return;
    try {
      await updateTarefa(tarefa.id!, { status });
      toast.success(
        status === 'concluida' ? t('detail.toast.completed') : t('detail.toast.statusUpdated'),
      );
      onRefresh();
    } catch {
      toast.error(t('detail.toast.statusError'));
    }
  };

  const handleAssign = async (responsavelId: number | null) => {
    try {
      await updateTarefa(tarefa.id!, { responsavel_id: responsavelId });
      toast.success(t('detail.toast.assigneeUpdated'));
      onRefresh();
    } catch {
      toast.error(t('detail.toast.assigneeError'));
    }
  };

  const handleAddSubtarefa = async () => {
    const titulo = newSubtarefa.trim();
    if (!titulo) return;
    try {
      await addSubtarefa({
        tarefa_id: tarefa.id!,
        titulo,
        concluida: false,
        ordem: subtarefas.length,
      });
      setNewSubtarefa('');
      refreshSubtarefas();
    } catch {
      toast.error(t('detail.toast.subtaskAddError'));
    }
  };

  const handleToggleSubtarefa = async (id: number, concluida: boolean) => {
    try {
      await toggleSubtarefa(id, concluida);
      refreshSubtarefas();
    } catch {
      toast.error(t('detail.toast.subtaskUpdateError'));
    }
  };

  const handleDeleteSubtarefa = async (id: number) => {
    try {
      await deleteSubtarefa(id);
      refreshSubtarefas();
    } catch {
      toast.error(t('detail.toast.subtaskRemoveError'));
    }
  };

  const handleDeleteTarefa = async () => {
    if (deleteInFlight.current) return;
    deleteInFlight.current = true;
    setDeleteBusy(true);
    try {
      await deleteTarefa(tarefa.id!);
      toast.success(t('detail.toast.deleted'));
      setConfirmDelete(false);
      onClose();
      onRefresh();
    } catch {
      toast.error(t('detail.toast.deleteError'));
    } finally {
      deleteInFlight.current = false;
      setDeleteBusy(false);
    }
  };

  const handleSerieEstado = async (verbo: 'pausar' | 'retomar' | 'encerrar') => {
    if (!serie || serieBusy) return;
    setSerieBusy(true);
    try {
      await definirEstadoSerie(serie.id, verbo);
      toast.success(
        verbo === 'pausar'
          ? t('detail.toast.seriesPaused')
          : verbo === 'retomar'
            ? t('detail.toast.seriesResumed')
            : t('detail.toast.seriesEnded'),
      );
      setConfirmEncerrar(false);
      onRefresh();
    } catch {
      toast.error(t('detail.toast.seriesError'));
    } finally {
      setSerieBusy(false);
    }
  };

  const handleDeleteSerie = async () => {
    if (!serie || deleteInFlight.current) return;
    deleteInFlight.current = true;
    setDeleteBusy(true);
    try {
      await deleteTarefaSerieCompleta(serie.id);
      toast.success(t('detail.toast.seriesDeleted'));
      setConfirmDelete(false);
      onClose();
      onRefresh();
    } catch {
      toast.error(t('detail.toast.seriesDeleteError'));
    } finally {
      deleteInFlight.current = false;
      setDeleteBusy(false);
    }
  };

  if (isPhone) {
    return (
      <TarefaDetailPhone
        open={open}
        tarefa={tarefa}
        membros={membros}
        subtarefas={subtarefas}
        serie={serie}
        estado={estado}
        estadoLabel={estadoLabel}
        serieBusy={serieBusy}
        newSubtarefa={newSubtarefa}
        onNewSubtarefaChange={setNewSubtarefa}
        onAddSubtarefa={handleAddSubtarefa}
        onToggleSubtarefa={handleToggleSubtarefa}
        onDeleteSubtarefa={handleDeleteSubtarefa}
        onStatusChange={handleStatusChange}
        onAssign={handleAssign}
        onSerieEstado={handleSerieEstado}
        onClose={onClose}
        onEdit={onEdit}
        onRefresh={onRefresh}
      />
    );
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-[440px] overflow-y-auto">
        <SheetHeader className="mb-4 pr-8">
          {view === 'historico' && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mb-0 -ml-2 h-7 w-fit px-2 text-xs"
              onClick={() => setView('detalhe')}
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> {t('historico.back')}
            </Button>
          )}
          <div className="flex items-start gap-2">
            <SheetTitle className="min-w-0 flex-1 text-left leading-snug">
              {tarefa.titulo}
            </SheetTitle>
            {view === 'detalhe' && (
              <div
                role="group"
                aria-label={t('detail.actionsLabel')}
                className="-mt-1.5 flex shrink-0 items-center gap-0.5"
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="mb-0 h-8 w-8"
                  aria-label={t('historico.title')}
                  title={t('historico.title')}
                  onClick={() => setView('historico')}
                >
                  <History className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="mb-0 h-8 w-8"
                  aria-label={t('actions.edit')}
                  title={t('actions.edit')}
                  onClick={onEdit}
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="mb-0 h-8 w-8"
                  style={{ color: 'var(--danger-text)' }}
                  aria-label={t('detail.delete')}
                  title={t('detail.delete')}
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            )}
          </div>
          <SheetDescription className="sr-only">{t('detail.srDescription')}</SheetDescription>
          {tarefa.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {tarefa.tags.map((tag) => (
                <TagPill key={tag.id} tag={tag} />
              ))}
            </div>
          )}
        </SheetHeader>

        {view === 'historico' ? (
          <section aria-labelledby="tarefa-historico-title" className="flex flex-col gap-3">
            <h3 id="tarefa-historico-title" className="text-sm font-semibold">
              {t('historico.title')}
            </h3>
            <TarefaHistoryPanel tarefaId={tarefa.id!} membros={membros} />
          </section>
        ) : (
          <div className="flex flex-col gap-5">
            {/* Status segmented buttons */}
            <div className="flex gap-1.5">
              {STATUS_ORDER.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => handleStatusChange(s)}
                  style={{
                    flex: 1,
                    padding: '0.4rem 0.5rem',
                    borderRadius: '8px',
                    fontSize: '0.72rem',
                    fontWeight: tarefa.status === s ? 700 : 400,
                    border:
                      tarefa.status === s
                        ? '1px solid var(--text-main)'
                        : '1px solid var(--border-color)',
                    background: tarefa.status === s ? 'var(--text-main)' : 'transparent',
                    color: tarefa.status === s ? 'var(--card-bg)' : 'var(--text-muted)',
                    cursor: 'pointer',
                    transition: 'background 150ms ease-out, color 150ms ease-out',
                  }}
                >
                  {STATUS_LABELS[s]}
                </button>
              ))}
            </div>

            {/* Meta rows */}
            <div className="flex flex-col gap-2.5 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-xs w-24 shrink-0" style={{ color: 'var(--text-muted)' }}>
                  {t('detail.assignee')}
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="board-card-assignee board-card-assignee--clickable"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        padding: '0.25rem 0.5rem 0.25rem 0.25rem',
                        borderRadius: '10px',
                        border: '1px solid var(--border-color)',
                        background: 'var(--card-bg)',
                        cursor: 'pointer',
                      }}
                    >
                      {membro ? (
                        <>
                          <PessoaAvatar
                            nome={membro.nome}
                            fotoUrl={membro.avatar_url}
                            seed={membro.id}
                            size={20}
                            className="!text-[0.55rem] !font-extrabold"
                          />
                          <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>
                            {membro.nome}
                          </span>
                        </>
                      ) : (
                        <>
                          <span
                            style={{
                              width: 20,
                              height: 20,
                              borderRadius: '50%',
                              background: 'var(--surface-hover)',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: 'var(--text-muted)',
                            }}
                          >
                            <User2 className="h-3 w-3" />
                          </span>
                          <span
                            style={{
                              fontSize: '0.75rem',
                              color: 'var(--text-muted)',
                              fontStyle: 'italic',
                            }}
                          >
                            {t('detail.noAssignee')}
                          </span>
                        </>
                      )}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" style={{ minWidth: '180px' }}>
                    <DropdownMenuItem
                      onClick={() => handleAssign(null)}
                      className="text-xs italic"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {t('detail.noAssignee')}
                    </DropdownMenuItem>
                    {membros
                      .filter((m) => m.id != null)
                      .map((m) => (
                        <DropdownMenuItem
                          key={m.id}
                          onClick={() => handleAssign(m.id!)}
                          className="flex items-center gap-2 text-xs cursor-pointer"
                        >
                          <PessoaAvatar
                            nome={m.nome}
                            fotoUrl={m.avatar_url}
                            seed={m.id}
                            size={16}
                            className="!text-[0.5rem]"
                          />
                          {m.nome}
                        </DropdownMenuItem>
                      ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs w-24 shrink-0" style={{ color: 'var(--text-muted)' }}>
                  {t('detail.due')}
                </span>
                <span className="inline-flex items-center gap-2 text-sm">
                  <CalendarDays className="h-3.5 w-3.5" style={{ color: 'var(--text-muted)' }} />
                  {tarefa.data_limite
                    ? parseDateOnly(tarefa.data_limite).toLocaleDateString(intlLocale)
                    : t('detail.noDue')}
                  {badge && (
                    <span className={`board-card-deadline ${badge.className}`}>{badge.label}</span>
                  )}
                </span>
              </div>

              {serie && estado && (
                <div className="flex items-start gap-2">
                  <span
                    className="text-xs w-24 shrink-0 pt-0.5"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {t('detail.recurrence')}
                  </span>
                  <div className="flex flex-col gap-1.5 text-sm">
                    <span className="inline-flex items-center gap-2 flex-wrap">
                      <Repeat className="h-3.5 w-3.5" style={{ color: 'var(--text-muted)' }} />
                      <span>
                        {t('detail.repeats', {
                          rule: describeRecorrencia(serie),
                          mode: modoLabel(serie.modo),
                        })}
                      </span>
                      {estadoLabel && (
                        <span
                          className="text-xs px-1.5 py-0.5 rounded-md"
                          style={{ background: 'var(--surface-hover)', color: 'var(--text-muted)' }}
                        >
                          {estadoLabel}
                        </span>
                      )}
                    </span>
                    {(estado === 'ativa' || estado === 'pausada') && (
                      <div className="flex gap-1.5">
                        {estado === 'ativa' ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            disabled={serieBusy}
                            onClick={() => handleSerieEstado('pausar')}
                          >
                            <Pause className="h-3 w-3 mr-1" /> {t('detail.pauseSeries')}
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            disabled={serieBusy}
                            onClick={() => handleSerieEstado('retomar')}
                          >
                            <Play className="h-3 w-3 mr-1" /> {t('detail.resumeSeries')}
                          </Button>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs"
                          disabled={serieBusy}
                          onClick={() => setConfirmEncerrar(true)}
                        >
                          <Ban className="h-3 w-3 mr-1" /> {t('detail.endSeries')}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {tarefa.cliente_nome && (
                <div className="flex items-center gap-2">
                  <span className="text-xs w-24 shrink-0" style={{ color: 'var(--text-muted)' }}>
                    {t('detail.client')}
                  </span>
                  <span className="text-sm">{tarefa.cliente_nome}</span>
                </div>
              )}
            </div>

            {(tarefa.descricao_rich || tarefa.descricao) && (
              <div>
                <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
                  {t('detail.description')}
                </div>
                <div className="text-sm" style={{ color: 'var(--text-main)' }}>
                  <TarefaDescriptionContent
                    richContent={tarefa.descricao_rich}
                    plainText={tarefa.descricao}
                  />
                </div>
              </div>
            )}

            {/* Checklist */}
            <div>
              <div className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
                {t('detail.subtasks')}
                {subtarefas.length > 0 && (
                  <span>
                    {' '}
                    · {subtarefas.filter((s) => s.concluida).length}/{subtarefas.length}
                  </span>
                )}
              </div>
              {serie && (
                <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
                  {t('detail.seriesChecklistHint')}
                </p>
              )}
              <div className="flex flex-col gap-1.5">
                {subtarefas.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 group">
                    <Checkbox
                      checked={s.concluida}
                      onCheckedChange={(checked) => handleToggleSubtarefa(s.id!, checked === true)}
                    />
                    <span
                      className="text-sm flex-1"
                      style={{
                        textDecoration: s.concluida ? 'line-through' : undefined,
                        color: s.concluida ? 'var(--text-muted)' : 'var(--text-main)',
                      }}
                    >
                      {s.titulo}
                    </span>
                    <button
                      type="button"
                      aria-label={t('detail.removeSubtask')}
                      onClick={() => handleDeleteSubtarefa(s.id!)}
                      className="opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 transition-opacity"
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--text-muted)',
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                <div className="flex items-center gap-2 mt-1">
                  <Input
                    placeholder={t('detail.newSubtaskPlaceholder')}
                    value={newSubtarefa}
                    onChange={(e) => setNewSubtarefa(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddSubtarefa();
                      }
                    }}
                    className="h-8 !text-xs mb-0"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 px-2 shrink-0"
                    disabled={!newSubtarefa.trim()}
                    onClick={handleAddSubtarefa}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>

            <TarefaComentarios
              tarefaId={tarefa.id!}
              membros={membros}
              autoFocus={autoFocusComments}
            />
          </div>
        )}

        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            {serie ? (
              <>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('detail.deleteRecurringTitle')}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t('detail.deleteRecurringDescription', { title: tarefa.titulo })}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="flex flex-col gap-3 text-sm">
                  <div>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      disabled={deleteBusy}
                      onClick={handleDeleteTarefa}
                    >
                      {t('detail.onlyThis')}
                    </Button>
                    {tarefa.status !== 'concluida' &&
                      serie.modo === 'ao_concluir' &&
                      estado === 'ativa' && (
                        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                          {t('detail.nextWillBeCreated')}
                        </p>
                      )}
                  </div>
                  <div>
                    <Button
                      type="button"
                      className="w-full bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90"
                      disabled={deleteBusy}
                      onClick={handleDeleteSerie}
                    >
                      {t('detail.wholeSeries')}
                    </Button>
                    <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                      {t('detail.wholeSeriesHint')}
                    </p>
                  </div>
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
                </AlertDialogFooter>
              </>
            ) : (
              <>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t('detail.deleteTitle')}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t('detail.deleteDescription', { title: tarefa.titulo })}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90"
                    onClick={handleDeleteTarefa}
                  >
                    {t('detail.deleteConfirm')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </>
            )}
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={confirmEncerrar} onOpenChange={setConfirmEncerrar}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('detail.endSeriesTitle')}</AlertDialogTitle>
              <AlertDialogDescription>{t('detail.endSeriesDescription')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
              <AlertDialogAction
                disabled={serieBusy}
                onClick={(e) => {
                  e.preventDefault();
                  handleSerieEstado('encerrar');
                }}
              >
                {t('detail.endConfirm')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}
