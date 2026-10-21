import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  EyeOff,
  ExternalLink,
  Save,
  Loader2,
  ImagePlus,
  ListChecks,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { useUnsavedWork } from '@mesaas/app-lifecycle';
import {
  listIdeiaImages,
  uploadIdeiaImage,
  removeIdeiaImage,
  type CrmIdeiaImage,
} from '@/services/ideiaMedia';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
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
import { IdeiaStatusBadge } from './IdeiaStatusBadge';
import { IdeiaTipoBadge } from './IdeiaTipoBadge';
import { IdeiaOrigemBadge } from './IdeiaOrigemBadge';
import { IdeiaAudioSection } from './IdeiaAudioSection';
import {
  updateIdeiaStatus,
  upsertIdeiaComentario,
  toggleIdeiaReaction,
  updateIdeiaVisibilidade,
  deleteIdeia,
  getMembros,
  getClientes,
  getTarefaTags,
  setTarefaTags,
  convertSolicitacaoEmTarefa,
  type Ideia,
} from '@/store';
import {
  TarefaFormDialog,
  type TarefaFormPayload,
} from '@/pages/tarefas/components/TarefaFormDialog';
import { useAuth } from '@/context/AuthContext';
import { useCurrentMembro } from '@/hooks/useCurrentMembro';
import { Switch } from '@/components/ui/switch';
import { sanitizeExternalUrl, sanitizeUrl } from '@/utils/security';
import { usePhoneLayout } from '@/components/layout/PhoneLayoutContext';
import { PhoneNavBar } from '@/components/mobile/PhoneNavBar';
import { PhoneIconButton } from '@/components/mobile/LargeTitleHeader';
import { Cell, GroupedList } from '@/components/mobile/GroupedList';
import { BottomActionBar } from '@/components/mobile/BottomActionBar';
import { ActionSheet, type ActionSheetAction } from '@/components/mobile/ActionSheet';
import { PickerSheet } from '@/components/mobile/PickerSheet';
import { PhoneConfirmSheet } from '@/components/mobile/PhoneConfirmSheet';
import {
  PhoneEditorScreen,
  type PhoneEditorScreenApi,
} from '@/pages/entregas/components/postEditorPhone/PhoneEditorScreen';
import { IDEIA_STATUS_LABELS } from '@/pages/ideias/ideiaLabels';
import { IdeiaStatusPill } from './IdeiaStatusPill';
import './ideiaPhone.css';

const ALLOWED_EMOJI = ['👍', '❤️', '🔥', '💡', '🎯'] as const;

const STATUS_OPTIONS: { value: Ideia['status']; label: string }[] = [
  { value: 'nova', label: 'Nova' },
  { value: 'em_analise', label: 'Em análise' },
  { value: 'aprovada', label: 'Aprovada' },
  { value: 'descartada', label: 'Descartada' },
];

const CONVERSIBLE_STATUSES: Ideia['status'][] = ['nova', 'em_analise', 'aprovada'];

interface IdeiaDrawerProps {
  ideia: Ideia;
  queryKey: unknown[];
  onClose: () => void;
  // Opens NovaIdeiaDialog in edit mode for this ideia; only rendered (below) for
  // agencia-origin ideias -- the CRM never edits a client-submitted one. Optional:
  // a caller without a create/edit dialog of its own (the cliente-detalhe hub tab)
  // just omits it, which hides "Editar" rather than wiring a no-op.
  onEdit?: () => void;
  // Shortcut from the card list: opens the drawer already focused on the action the user
  // asked for instead of dropping them at the top. Optional -- every other call site keeps
  // opening on the description with no initial focus/dialog, exactly as before this prop
  // existed.
  initialAction?: 'responder' | 'converter';
}

export function IdeiaDrawer({ ideia, queryKey, onClose, onEdit, initialAction }: IdeiaDrawerProps) {
  const qc = useQueryClient();
  const { can } = useAuth();
  // IdeiasPage/IdeiaDrawer had NO role check at all before Task 14 -- any
  // authenticated member could add or remove an idea's reference images.
  // AGENT_ROLE_PRESET.ideias is 'editar' (lib/permissions.ts), so this
  // preserves full access for every legacy chassis role byte-for-byte; only
  // a CUSTOM role (role_id set) can now differ from full access.
  const canEditIdeias = can('ideias', 'editar') === true;

  const { data: membros = [] } = useQuery({
    queryKey: ['membros'],
    queryFn: getMembros,
  });
  const { membro } = useCurrentMembro();
  const membroId: number | undefined = membro?.id;
  const isAgency = ideia.origem === 'agencia';
  const [visSaving, setVisSaving] = useState(false);

  const [convertOpen, setConvertOpen] = useState(false);
  const { data: clientes = [] } = useQuery({ queryKey: ['clientes'], queryFn: getClientes });
  const { data: tarefaTags = [] } = useQuery({ queryKey: ['tarefa-tags'], queryFn: getTarefaTags });

  const isConverted = ideia.status === 'convertida' || ideia.status === 'concluida';
  const statusLocked = isConverted && ideia.tarefa_id != null;
  const canConvert = ideia.tipo === 'solicitacao' && CONVERSIBLE_STATUSES.includes(ideia.status);

  const comentarioRef = useRef<HTMLTextAreaElement>(null);

  // Runs once per mount -- a drawer instance lives for exactly one open/close cycle (the
  // Sheet overlay blocks the card grid behind it, so there's no way to swap `ideia` on a
  // still-mounted drawer through the UI). Intentionally not keyed on `canConvert`/`ideia`.
  // The 'responder' focus shortcut is handled separately via SheetContent's
  // onOpenAutoFocus below -- Radix's FocusScope grabs focus onto the first tabbable
  // element in its own mount effect, which (via an internal ref-callback-driven
  // re-render) resolves after a plain useEffect here would have already run, so a
  // .focus() call from this effect loses the race and gets overridden right back.
  useEffect(() => {
    if (initialAction === 'converter' && canConvert) {
      setConvertOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleConvertCreate(payload: TarefaFormPayload, tagIds: number[]) {
    // A RPC e o commit da conversao; tags sao best-effort depois dela.
    const tarefaId = await convertSolicitacaoEmTarefa({
      ideiaId: ideia.id,
      titulo: payload.titulo,
      descricao: payload.descricao,
      descricaoRich: payload.descricao_rich,
      responsavelId: payload.responsavel_id,
      dataLimite: payload.data_limite,
    });
    let tagsOk = true;
    if (tagIds.length > 0) {
      try {
        await setTarefaTags(tarefaId, tagIds);
      } catch {
        tagsOk = false;
      }
    }
    qc.invalidateQueries({ queryKey });
    qc.invalidateQueries({ queryKey: ['tarefas'] });
    if (tagsOk) toast.success('Solicitação convertida em tarefa!');
    else
      toast.warning(
        'Tarefa criada, mas as tags não foram aplicadas. Edite a tarefa para adicioná-las.',
      );
  }

  const MAX_IMAGES = 10;
  const inputRef = useRef<HTMLInputElement>(null);
  const [imgBusy, setImgBusy] = useState(false);

  const { data: images = [] } = useQuery({
    queryKey: ['ideia-images', ideia.id],
    queryFn: () => listIdeiaImages(ideia.id),
  });

  async function handleImageFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setImgBusy(true);
    const slots = MAX_IMAGES - images.length;
    const chosen = Array.from(files).slice(0, slots);
    try {
      for (let i = 0; i < chosen.length; i++) {
        await uploadIdeiaImage(ideia.id, chosen[i], images.length + i);
      }
      qc.invalidateQueries({ queryKey: ['ideia-images', ideia.id] });
      qc.invalidateQueries({ queryKey });
      toast.success('Imagem adicionada.');
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao enviar imagem.');
    } finally {
      setImgBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function handleRemoveImage(fileId: number) {
    setImgBusy(true);
    try {
      await removeIdeiaImage(ideia.id, fileId);
      qc.invalidateQueries({ queryKey: ['ideia-images', ideia.id] });
      qc.invalidateQueries({ queryKey });
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao remover imagem.');
    } finally {
      setImgBusy(false);
    }
  }

  const [statusSaving, setStatusSaving] = useState(false);
  const [comentario, setComentario] = useState(ideia.comentario_agencia ?? '');
  const [comentarioSaving, setComentarioSaving] = useState(false);
  const [reactionLoading, setReactionLoading] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Phone (below 768px inside the shell): the drawer is a pushed screen instead of the
  // right Sheet. Gated on the shell context, not the viewport, so the drawer rendered
  // outside AppLayout (tests, isolated trees) keeps the desktop Sheet.
  const { isPhone } = usePhoneLayout();
  const navigate = useNavigate();
  // The screen stays mounted for one open/close cycle and is closed locally first: its
  // history entry is popped only while it is mounted, so every exit (Back, Excluir,
  // Editar, Ver tarefa) closes the screen, waits for the pop, and only then tells the
  // parent, which unmounts the drawer.
  const [screenOpen, setScreenOpen] = useState(true);
  const screenApiRef = useRef<PhoneEditorScreenApi | null>(null);
  const uiClosingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const handleScreenClose = useCallback(() => {
    setScreenOpen(false);
    // Back (edge swipe, Android back) already popped the entry: tell the parent now.
    if (!uiClosingRef.current) onCloseRef.current();
  }, []);
  const requestClose = (then: () => void = () => onCloseRef.current()) => {
    const api = screenApiRef.current;
    if (!isPhone || !api) {
      then();
      return;
    }
    uiClosingRef.current = true;
    api.closeThen(then);
  };
  const [menuOpen, setMenuOpen] = useState(false);
  const [statusPickerOpen, setStatusPickerOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  // Outside a dialog the comment draft is an editor of its own (CLAUDE.md, silent updates):
  // on desktop the Sheet is a dialog and already holds deploy swaps.
  const comentarioDirty = comentario !== (ideia.comentario_agencia ?? '');
  useUnsavedWork(isPhone && (comentarioDirty || comentarioSaving));

  // "Responder" shortcut on phones: the screen focuses its own root when it opens (its
  // effect runs first, as a child), so this focus on the response field wins.
  useEffect(() => {
    if (isPhone && initialAction === 'responder') comentarioRef.current?.focus();
    // Once per mount, like the converter shortcut above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }

  async function handleStatusChange(newStatus: Ideia['status']) {
    setStatusSaving(true);
    try {
      await updateIdeiaStatus(ideia.id, newStatus);
      qc.invalidateQueries({ queryKey });
      toast.success('Status atualizado.');
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao atualizar status.');
    } finally {
      setStatusSaving(false);
    }
  }

  async function handleVisibilidade(next: boolean) {
    setVisSaving(true);
    try {
      await updateIdeiaVisibilidade(ideia.id, next);
      qc.invalidateQueries({ queryKey });
      toast.success(next ? 'Ideia visível no Hub.' : 'Ideia oculta do Hub.');
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao atualizar visibilidade.');
    } finally {
      setVisSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await deleteIdeia(ideia.id);
      qc.invalidateQueries({ queryKey });
      toast.success('Ideia excluída.');
      setConfirmDelete(false);
      requestClose();
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao excluir ideia.');
    } finally {
      setDeleting(false);
    }
  }

  async function handleSaveComentario() {
    if (!membroId) return;
    setComentarioSaving(true);
    try {
      await upsertIdeiaComentario(ideia.id, comentario, membroId);
      qc.invalidateQueries({ queryKey });
      toast.success('Comentário salvo.');
    } catch (e: any) {
      toast.error(e.message ?? 'Erro ao salvar comentário.');
    } finally {
      setComentarioSaving(false);
    }
  }

  async function handleReaction(emoji: string) {
    if (!membroId) return;
    setReactionLoading(emoji);
    try {
      await toggleIdeiaReaction(ideia.id, membroId, emoji);
      qc.invalidateQueries({ queryKey });
    } catch (e: any) {
      toast.error(e.message ?? 'Erro.');
    } finally {
      setReactionLoading(null);
    }
  }

  const reactionMap = new Map<string, { count: number; names: string[]; myReaction: boolean }>();
  for (const r of ideia.ideia_reactions) {
    const entry = reactionMap.get(r.emoji) ?? { count: 0, names: [], myReaction: false };
    entry.count++;
    entry.names.push(r.membros.nome);
    if (r.membro_id === membroId) entry.myReaction = true;
    reactionMap.set(r.emoji, entry);
  }

  const tarefaForm = (
    <TarefaFormDialog
      open={convertOpen}
      onClose={() => setConvertOpen(false)}
      editing={null}
      membros={membros}
      clientes={clientes}
      tags={tarefaTags}
      onSaved={() => {}}
      onTagCreated={() => qc.invalidateQueries({ queryKey: ['tarefa-tags'] })}
      initialValues={{
        titulo: ideia.titulo,
        descricao: ideia.descricao ?? undefined,
        cliente_id: ideia.cliente_id,
      }}
      lockCliente
      onCreate={handleConvertCreate}
    />
  );

  if (isPhone) {
    const canEditThis = isAgency && canEditIdeias && !!onEdit;
    const menuActions: ActionSheetAction[] = [];
    if (canEditThis) {
      menuActions.push({
        label: 'Editar',
        icon: <Pencil aria-hidden="true" />,
        onSelect: () => requestClose(() => onEdit?.()),
      });
    }
    if (canEditIdeias) {
      menuActions.push({
        label: 'Excluir',
        icon: <Trash2 aria-hidden="true" />,
        destructive: true,
        onSelect: () => setConfirmDelete(true),
      });
    }
    const statusValue =
      CONVERSIBLE_STATUSES.includes(ideia.status) || ideia.status === 'descartada'
        ? ideia.status
        : null;
    const statusLabel = IDEIA_STATUS_LABELS[ideia.status] ?? ideia.status;
    const hiddenFromHub = isAgency && !ideia.visivel_no_hub;

    return (
      <>
        <PhoneEditorScreen
          open={screenOpen}
          onClose={handleScreenClose}
          label={`Ideia: ${ideia.titulo}`}
          apiRef={screenApiRef}
          className="phone-ideia"
        >
          <div className="phone-ideia__bar">
            <PhoneNavBar
              backLabel="Voltar"
              onBack={() => requestClose()}
              trailing={
                menuActions.length > 0 ? (
                  <PhoneIconButton
                    ref={menuButtonRef}
                    label="Mais ações da ideia"
                    aria-haspopup="dialog"
                    onClick={() => setMenuOpen(true)}
                  >
                    <MoreHorizontal aria-hidden="true" />
                  </PhoneIconButton>
                ) : undefined
              }
            />
          </div>
          <div className="phone-ideia__scroll">
            <header className="phone-ideia__head">
              <h2 className="phone-ideia__title">{ideia.titulo}</h2>
              <p className="phone-ideia__meta">
                {ideia.clientes.nome} · {formatDate(ideia.created_at)}
                {isAgency && ideia.autor ? ` · por ${ideia.autor.nome}` : ''}
              </p>
              <div className="phone-ideia__chips">
                {statusLocked ? (
                  <IdeiaStatusPill status={ideia.status} />
                ) : (
                  <button
                    type="button"
                    className={`phone-ideia-pill phone-ideia-pill--${ideia.status} phone-ideia__status`}
                    aria-label={`Status: ${statusLabel}. Trocar status`}
                    aria-haspopup="dialog"
                    disabled={statusSaving}
                    onClick={() => setStatusPickerOpen(true)}
                  >
                    <span className="phone-ideia-pill__dot" aria-hidden="true" />
                    {statusLabel}
                  </button>
                )}
                <span className="phone-ideia__tag">
                  {ideia.tipo === 'solicitacao' ? 'Solicitação' : 'Ideia'}
                </span>
                <span className="phone-ideia__tag">
                  {hiddenFromHub && <EyeOff aria-hidden="true" />}
                  {isAgency ? 'Agência' : 'Cliente'}
                  {hiddenFromHub ? ' · Oculta do Hub' : ''}
                </span>
              </div>
            </header>

            {statusLocked && (
              <GroupedList aria-label="Tarefa">
                <Cell
                  label="Ver tarefa"
                  icon={<ListChecks aria-hidden="true" />}
                  chevron
                  onClick={() =>
                    requestClose(() => {
                      onCloseRef.current();
                      navigate(`/tarefas?tarefa=${ideia.tarefa_id}`);
                    })
                  }
                />
              </GroupedList>
            )}

            {isAgency && canEditIdeias && (
              <GroupedList
                footer="O cliente vê e reage, mas não edita."
                aria-label="Hub do cliente"
              >
                <Cell
                  label="Visível no Hub do cliente"
                  disabled={visSaving}
                  switch={{ checked: ideia.visivel_no_hub, onCheckedChange: handleVisibilidade }}
                />
              </GroupedList>
            )}

            {ideia.descricao && (
              <GroupedList header="Descrição">
                <li className="phone-cell">
                  <p className="phone-ideia__text">{ideia.descricao}</p>
                </li>
              </GroupedList>
            )}

            <div className="phone-ideia__card">
              <IdeiaAudioSection
                ideia={ideia}
                canWrite={isAgency && canEditIdeias}
                queryKey={queryKey}
              />
            </div>

            {ideia.links.length > 0 && (
              <GroupedList header="Links de referência">
                {ideia.links.map((link, i) => (
                  <li key={i} className="phone-cell">
                    <a
                      href={sanitizeUrl(link)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="phone-ideia__link"
                    >
                      <ExternalLink aria-hidden="true" />
                      <span>{link}</span>
                    </a>
                  </li>
                ))}
              </GroupedList>
            )}

            {(images.length > 0 || canEditIdeias) && (
              <GroupedList header={`Imagens · ${images.length} de ${MAX_IMAGES}`}>
                <li className="phone-cell">
                  <div className="phone-ideia__images">
                    {images.map((img: CrmIdeiaImage) => (
                      <div key={img.file_id} className="phone-ideia__thumb">
                        <a
                          href={sanitizeExternalUrl(img.url)}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label="Abrir imagem"
                        >
                          <img src={img.thumbnail_url ?? img.url} alt="" />
                        </a>
                        {canEditIdeias && (
                          <button
                            type="button"
                            className="phone-ideia__remove"
                            onClick={() => handleRemoveImage(img.file_id)}
                            disabled={imgBusy}
                            aria-label="Remover imagem"
                          >
                            <X aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    ))}
                    {canEditIdeias && images.length < MAX_IMAGES && (
                      <button
                        type="button"
                        className="phone-ideia__add"
                        disabled={imgBusy}
                        onClick={() => inputRef.current?.click()}
                        aria-label="Adicionar imagem"
                      >
                        {imgBusy ? (
                          <Loader2 aria-hidden="true" className="animate-spin" />
                        ) : (
                          <Plus aria-hidden="true" />
                        )}
                        Adicionar
                      </button>
                    )}
                  </div>
                </li>
              </GroupedList>
            )}
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              multiple
              className="hidden"
              onChange={(e) => handleImageFiles(e.target.files)}
            />

            <section className="phone-kit phone-group">
              <h2 className="phone-group__header">Reações</h2>
              <div className="phone-ideia__reactions">
                {ALLOWED_EMOJI.map((emoji) => {
                  const entry = reactionMap.get(emoji);
                  const active = entry?.myReaction ?? false;
                  return (
                    <button
                      key={emoji}
                      type="button"
                      className="phone-ideia__reaction"
                      aria-pressed={active}
                      aria-label={
                        entry
                          ? `${emoji} ${entry.count}: ${entry.names.join(', ')}`
                          : `Reagir com ${emoji}`
                      }
                      onClick={() => handleReaction(emoji)}
                      disabled={reactionLoading === emoji}
                    >
                      {reactionLoading === emoji ? (
                        <Loader2 aria-hidden="true" className="animate-spin" />
                      ) : (
                        <span aria-hidden="true">{emoji}</span>
                      )}
                      {entry && (
                        <span className="phone-ideia__reaction-count" aria-hidden="true">
                          {entry.count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="phone-kit phone-group">
              <h2 className="phone-group__header">
                <label htmlFor={`ideia-comentario-${ideia.id}`}>Resposta da agência</label>
              </h2>
              <div className="phone-ideia__card">
                <textarea
                  id={`ideia-comentario-${ideia.id}`}
                  ref={comentarioRef}
                  value={comentario}
                  onChange={(e) => setComentario(e.target.value)}
                  placeholder="Escreva uma resposta para o cliente..."
                  className="phone-ideia__comment"
                />
                <div className="phone-ideia__comment-foot">
                  {ideia.comentario_at && (
                    <span className="phone-ideia__edited">
                      Editado em {formatDate(ideia.comentario_at)}
                      {ideia.comentario_autor && ` por ${ideia.comentario_autor.nome}`}
                    </span>
                  )}
                  <button
                    type="button"
                    className="phone-ideia__save"
                    onClick={handleSaveComentario}
                    disabled={comentarioSaving}
                  >
                    {comentarioSaving ? (
                      <Loader2 aria-hidden="true" className="animate-spin" />
                    ) : (
                      <Save aria-hidden="true" />
                    )}
                    Salvar comentário
                  </button>
                </div>
              </div>
            </section>

            {canConvert && (
              <BottomActionBar>
                <button
                  type="button"
                  className="phone-ideia__primary"
                  onClick={() => setConvertOpen(true)}
                >
                  <ListChecks aria-hidden="true" />
                  Converter em tarefa
                </button>
              </BottomActionBar>
            )}
          </div>
        </PhoneEditorScreen>

        <PickerSheet<Ideia['status']>
          open={statusPickerOpen}
          onOpenChange={setStatusPickerOpen}
          title="Status"
          options={STATUS_OPTIONS}
          value={statusValue}
          onChange={(next) => {
            if (next && next !== ideia.status) void handleStatusChange(next);
          }}
        />

        <ActionSheet
          open={menuOpen}
          onOpenChange={setMenuOpen}
          title="Ações da ideia"
          hideTitle
          actions={menuActions}
          returnFocusRef={menuButtonRef}
        />

        <PhoneConfirmSheet
          open={confirmDelete}
          title="Excluir ideia?"
          message={`A ideia "${ideia.titulo}" será excluída, junto com seu áudio, imagens e reações. Essa ação não pode ser desfeita.`}
          onCancel={() => setConfirmDelete(false)}
          actions={[
            {
              label: 'Excluir ideia',
              destructive: true,
              disabled: deleting,
              onSelect: () => {
                // Closed before the request: a failed delete must leave the sheet able
                // to open again (PhoneConfirmSheet stays hidden while `open` is true).
                setConfirmDelete(false);
                void handleDelete();
              },
            },
          ]}
        />

        {tarefaForm}
      </>
    );
  }

  return (
    <Sheet
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg flex flex-col p-0 gap-0"
        onOpenAutoFocus={(event) => {
          if (initialAction === 'responder') {
            event.preventDefault();
            comentarioRef.current?.focus();
          }
        }}
      >
        <SheetHeader className="px-6 py-5 border-b border-border space-y-1.5">
          <div className="mb-1.5 flex gap-1.5">
            <IdeiaStatusBadge status={ideia.status} />
            <IdeiaTipoBadge tipo={ideia.tipo} />
            <IdeiaOrigemBadge origem={ideia.origem} hidden={isAgency && !ideia.visivel_no_hub} />
          </div>
          <SheetTitle className="text-base leading-snug">{ideia.titulo}</SheetTitle>
          <SheetDescription className="text-xs">
            {ideia.clientes.nome} · {formatDate(ideia.created_at)}
            {isAgency && ideia.autor ? ` · por ${ideia.autor.nome}` : ''}
          </SheetDescription>
        </SheetHeader>

        {/* The panel does scroll (flex-1 + overflow-y-auto below) -- on a short window with a
            long ideia (audio + transcript + images) the last item can sit right at the
            viewport edge with no OS scrollbar visible (macOS default), reading as truncated
            rather than scrollable. This fade is a constant visual cue that more sits below,
            independent of the platform's scrollbar visibility setting. */}
        <div className="flex-1 relative overflow-hidden">
          <div className="h-full overflow-y-auto px-6 py-5 space-y-6">
            {isAgency && canEditIdeias && (
              <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
                <div>
                  <p className="text-sm font-medium">Visível no Hub do cliente</p>
                  <p className="text-xs text-muted-foreground">
                    O cliente vê e reage, mas não edita.
                  </p>
                </div>
                <Switch
                  checked={ideia.visivel_no_hub}
                  onCheckedChange={handleVisibilidade}
                  disabled={visSaving}
                  aria-label="Visível no Hub do cliente"
                />
              </div>
            )}

            {ideia.descricao && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">Descrição</p>
                <p className="text-sm whitespace-pre-wrap">{ideia.descricao}</p>
              </div>
            )}

            <IdeiaAudioSection
              ideia={ideia}
              canWrite={isAgency && canEditIdeias}
              queryKey={queryKey}
            />

            {ideia.links.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1.5">
                  Links de referência
                </p>
                <div className="space-y-1">
                  {ideia.links.map((link, i) => (
                    <a
                      key={i}
                      href={sanitizeUrl(link)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground underline underline-offset-2 transition-colors"
                    >
                      <ExternalLink size={12} />
                      {link.length > 55 ? link.slice(0, 55) + '…' : link}
                    </a>
                  ))}
                </div>
              </div>
            )}

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Imagens</p>
              {images.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                  {images.map((img: CrmIdeiaImage) => (
                    <div key={img.file_id} className="relative group">
                      <a
                        href={sanitizeExternalUrl(img.url)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <img
                          src={img.thumbnail_url ?? img.url}
                          alt=""
                          className="h-16 w-16 rounded-md object-cover border border-border bg-muted"
                        />
                      </a>
                      {canEditIdeias && (
                        <button
                          onClick={() => handleRemoveImage(img.file_id)}
                          disabled={imgBusy}
                          aria-label="Remover imagem"
                          className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-foreground text-background opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 transition-opacity disabled:opacity-50"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {canEditIdeias && images.length < MAX_IMAGES && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={imgBusy}
                  onClick={() => inputRef.current?.click()}
                >
                  {imgBusy ? (
                    <Loader2 size={13} className="animate-spin mr-1.5" />
                  ) : (
                    <ImagePlus size={13} className="mr-1.5" />
                  )}
                  Adicionar imagem
                </Button>
              )}
              <input
                ref={inputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                multiple
                className="hidden"
                onChange={(e) => handleImageFiles(e.target.files)}
              />
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Status</p>
              {statusLocked ? (
                <div className="flex items-center gap-3">
                  <IdeiaStatusBadge status={ideia.status} />
                  <Link
                    to={`/tarefas?tarefa=${ideia.tarefa_id}`}
                    className="inline-flex items-center gap-1.5 text-sm underline underline-offset-2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <ListChecks size={14} />
                    Ver tarefa
                  </Link>
                </div>
              ) : (
                <Select
                  value={
                    CONVERSIBLE_STATUSES.includes(ideia.status) || ideia.status === 'descartada'
                      ? ideia.status
                      : undefined
                  }
                  onValueChange={(v) => handleStatusChange(v as Ideia['status'])}
                  disabled={statusSaving}
                >
                  <SelectTrigger className="w-48">
                    <SelectValue placeholder="Selecionar status..." />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {canConvert && (
                <Button size="sm" className="mt-3" onClick={() => setConvertOpen(true)}>
                  <ListChecks size={13} className="mr-1.5" />
                  Converter em tarefa
                </Button>
              )}
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Reações</p>
              <div className="flex flex-wrap gap-2">
                {ALLOWED_EMOJI.map((emoji) => {
                  const entry = reactionMap.get(emoji);
                  const active = entry?.myReaction ?? false;
                  return (
                    <Button
                      key={emoji}
                      type="button"
                      variant={active ? 'ink' : 'outline'}
                      size="sm"
                      onClick={() => handleReaction(emoji)}
                      disabled={reactionLoading === emoji}
                      title={entry?.names.join(', ') ?? ''}
                      className="rounded-full gap-1.5"
                    >
                      {reactionLoading === emoji ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        emoji
                      )}
                      {entry && <span className="font-medium text-[12px]">{entry.count}</span>}
                    </Button>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">
                Resposta da agência
                {ideia.comentario_at && (
                  <span className="ml-1.5 normal-case tracking-normal text-muted-foreground/70 font-normal">
                    — editado em {formatDate(ideia.comentario_at)}
                    {ideia.comentario_autor && ` por ${ideia.comentario_autor.nome}`}
                  </span>
                )}
              </p>
              <Textarea
                ref={comentarioRef}
                value={comentario}
                onChange={(e) => setComentario(e.target.value)}
                placeholder="Escreva uma resposta para o cliente..."
                className="min-h-[90px] resize-none rounded-[8px]"
              />
              <Button
                size="sm"
                variant="ink"
                className="mt-2"
                onClick={handleSaveComentario}
                disabled={comentarioSaving}
              >
                {comentarioSaving && <Loader2 size={13} className="animate-spin mr-1.5" />}
                <Save size={13} className="mr-1.5" />
                Salvar comentário
              </Button>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-border">
              {isAgency && canEditIdeias && onEdit ? (
                <Button type="button" variant="ink" size="sm" onClick={onEdit}>
                  <Pencil size={13} className="mr-1.5" /> Editar
                </Button>
              ) : (
                <span />
              )}
              {canEditIdeias && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-[var(--danger-text)]"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 size={13} className="mr-1.5" /> Excluir
                </Button>
              )}
            </div>
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-background to-transparent" />
        </div>
      </SheetContent>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir ideia?</AlertDialogTitle>
            <AlertDialogDescription>
              A ideia &quot;{ideia.titulo}&quot; será excluída, junto com seu áudio, imagens e
              reações. Essa ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90"
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
            >
              {deleting && <Loader2 size={13} className="animate-spin mr-1.5" />}
              Excluir ideia
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {tarefaForm}
    </Sheet>
  );
}
