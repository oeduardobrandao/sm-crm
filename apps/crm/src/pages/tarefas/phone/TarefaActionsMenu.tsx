import { useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import {
  ArrowRightLeft,
  CalendarDays,
  CheckCircle2,
  Edit2,
  ExternalLink,
  RotateCcw,
  Trash2,
  User,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  ContextMenu,
  type ContextMenuAction,
  type ContextMenuTriggerProps,
} from '@/components/mobile/ContextMenu';
import type { TarefaWithRelations } from '../../../store';
import { assignTarefa, rescheduleTarefa, toggleTarefaConcluida } from '../tarefaCommands';
import { MembroAvatar, useTarefasPhoneActions } from './parts';
import { PrazoSheet } from './PrazoSheet';
import { ActionPickerSheet } from './ActionPickerSheet';
import { TarefaDeleteConfirm } from './TarefaDeleteConfirm';

export interface MoveTarget {
  id: string;
  label: string;
}

/** Lets a row's swipe actions reach the menu and the delete confirmation. */
export interface TarefaActionsMenuApi {
  openMenu: () => void;
  requestDelete: () => void;
}

export interface TarefaActionsMenuProps {
  tarefa: TarefaWithRelations;
  /** "Mover para…" choices: the board's other columns, or the statuses in the Lista. */
  moveTargets?: MoveTarget[];
  moveTitle?: string;
  onMove?: (targetId: string) => void;
  /** False inside a member column, where "Mover para" already reassigns. */
  showAssign?: boolean;
  /** Replaces the default reschedule (views with optimistic overrides pass their own). */
  onReschedule?: (date: string | null) => void;
  onRefresh: () => void;
  preview?: ReactNode;
  className?: string;
  apiRef?: MutableRefObject<TarefaActionsMenuApi | null>;
  /** The hold target. */
  children: (api: { triggerProps: ContextMenuTriggerProps }) => ReactNode;
}

type Sheet = 'move' | 'assign' | 'prazo' | 'delete' | null;

/**
 * Long-press menu of a tarefa on phones (FTarefasKanban: "Segure um cartão para mover").
 * Everything the desktop card and board do by drag or hover, as menu actions: Mover
 * para (the board's own drop handler), Atribuir, Prazo, Concluir/Reabrir, Editar,
 * Excluir (with the series scope). Each picker opens after the menu's history entry
 * is gone, so two overlays never swap in one commit.
 */
export function TarefaActionsMenu({
  tarefa,
  moveTargets = [],
  moveTitle: moveTitleProp,
  onMove,
  showAssign = true,
  onReschedule,
  onRefresh,
  preview,
  className,
  apiRef,
  children,
}: TarefaActionsMenuProps) {
  const { t } = useTranslation('tasksPhone');
  const moveTitle = moveTitleProp ?? t('shared.moveTo');
  const ctx = useTarefasPhoneActions();
  const [sheet, setSheetState] = useState<Sheet>(null);
  // A sheet mounts on its first use and stays mounted: its history entry is popped on
  // close only while it is still mounted (useOverlayHistoryEntry never pops on unmount).
  const [used, setUsed] = useState<ReadonlySet<Exclude<Sheet, null>>>(() => new Set());
  const setSheet = (next: Sheet) => {
    if (next) setUsed((prev) => (prev.has(next) ? prev : new Set(prev).add(next)));
    setSheetState(next);
  };
  const openMenuRef = useRef<() => void>(() => {});
  if (apiRef)
    apiRef.current = {
      openMenu: () => openMenuRef.current(),
      requestDelete: () => setSheet('delete'),
    };
  const membros = ctx?.membros ?? [];
  const done = tarefa.status === 'concluida';

  const main: ContextMenuAction[] = [];
  if (ctx)
    main.push({
      label: t('actionsMenu.open'),
      icon: <ExternalLink aria-hidden="true" />,
      onSelect: () => ctx.openDetail(tarefa),
    });
  main.push({
    label: done ? t('shared.reopen') : t('shared.complete'),
    icon: done ? <RotateCcw aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />,
    onSelect: () => void toggleTarefaConcluida(tarefa, !done, onRefresh),
  });

  const move: ContextMenuAction[] = [];
  if (onMove && moveTargets.length > 0)
    move.push({
      label: t('actionsMenu.moveEllipsis', { title: moveTitle }),
      icon: <ArrowRightLeft aria-hidden="true" />,
      onSelect: () => setSheet('move'),
    });
  if (showAssign && membros.length > 0)
    move.push({
      label:
        tarefa.responsavel_id != null ? t('actionsMenu.changeAssignee') : t('actionsMenu.assign'),
      icon: <User aria-hidden="true" />,
      onSelect: () => setSheet('assign'),
    });
  move.push({
    label: tarefa.data_limite ? t('actionsMenu.changeDueDate') : t('actionsMenu.setDueDate'),
    icon: <CalendarDays aria-hidden="true" />,
    onSelect: () => setSheet('prazo'),
  });

  const edit: ContextMenuAction[] = ctx
    ? [
        {
          label: t('actionsMenu.edit'),
          icon: <Edit2 aria-hidden="true" />,
          onSelect: () => ctx.edit(tarefa),
        },
      ]
    : [];
  const danger: ContextMenuAction[] = [
    {
      label: t('shared.delete'),
      icon: <Trash2 aria-hidden="true" />,
      destructive: true,
      onSelect: () => setSheet('delete'),
    },
  ];

  const close = (open: boolean) => {
    if (!open) setSheet(null);
  };
  const sortedMembros = [...membros]
    .filter((m) => m.id != null)
    .sort((a, b) => a.nome.localeCompare(b.nome));

  return (
    <>
      <ContextMenu
        label={t('actionsMenu.menuLabel', { title: tarefa.titulo })}
        sections={[main, move, edit, danger].filter((s) => s.length > 0)}
        preview={preview}
        className={className}
      >
        {(api) => {
          openMenuRef.current = api.triggerProps.onClick;
          return children(api);
        }}
      </ContextMenu>
      {used.has('move') && onMove && (
        <ActionPickerSheet<string>
          open={sheet === 'move'}
          onOpenChange={close}
          title={moveTitle}
          description={t('actionsMenu.moveDescription', { moveTitle, title: tarefa.titulo })}
          options={moveTargets.map((t) => ({ value: t.id, label: t.label }))}
          value={null}
          onPick={(id) => {
            if (id != null) onMove(id);
          }}
        />
      )}
      {used.has('assign') && (
        <ActionPickerSheet<number>
          open={sheet === 'assign'}
          onOpenChange={close}
          title={t('shared.assignee')}
          description={t('actionsMenu.assigneeDescription', { title: tarefa.titulo })}
          searchable={sortedMembros.length > 8}
          emptyOption={{ label: t('shared.noAssignee') }}
          options={sortedMembros.map((m) => ({
            value: m.id!,
            label: m.nome,
            icon: <MembroAvatar membro={m} large />,
          }))}
          value={tarefa.responsavel_id ?? null}
          onPick={(id) => void assignTarefa(tarefa, id, onRefresh)}
        />
      )}
      {used.has('prazo') && (
        <PrazoSheet
          tarefa={tarefa}
          open={sheet === 'prazo'}
          onOpenChange={close}
          onSave={(date) =>
            onReschedule ? onReschedule(date) : void rescheduleTarefa(tarefa, date, onRefresh)
          }
        />
      )}
      {used.has('delete') && (
        <TarefaDeleteConfirm
          tarefa={tarefa}
          open={sheet === 'delete'}
          onOpenChange={close}
          onRefresh={onRefresh}
        />
      )}
    </>
  );
}
