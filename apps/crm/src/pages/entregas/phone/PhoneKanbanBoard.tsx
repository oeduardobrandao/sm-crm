import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  DndContext,
  DragOverlay,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type SensorDescriptor,
  type SensorOptions,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowUpDown, ChevronDown, Plus } from 'lucide-react';
import { ActionSheet } from '@/components/mobile/ActionSheet';
import { Chip, ChipRow } from '@/components/mobile/ChipRow';
import type { Membro } from '../../../store';
import type { FluxosColumnSort } from '../entregasPrefs';
import { columnKey, type BoardColumn, type BoardRow } from '../boardRows';
import type { BoardEntity, PostEntity } from '../boardEntity';
import { sortableIdOf } from '../boardReorder';
import type { BoardCard } from '../hooks/useEntregasData';
import { PostProcessCardMenu, WorkflowCardMenu } from './cardMenus';
import {
  PhoneDragHandle,
  PhonePostProcessCard,
  PhoneWorkflowCard,
  type WorkflowCardCounts,
} from './PhoneBoardCards';
import './entregasPhone.css';

export interface PhoneKanbanWorkflowActions {
  open: (card: BoardCard) => void;
  edit: (card: BoardCard) => void;
  forward: (card: BoardCard) => void;
  revert: (card: BoardCard) => void;
  duplicate?: (card: BoardCard) => void;
  remove?: (card: BoardCard) => void;
}

export interface PhoneKanbanPostActions {
  open?: (entity: PostEntity) => void;
  forward: (entity: PostEntity) => void;
  forwardLabel: (entity: PostEntity) => 'Avançar etapa' | 'Concluir processo';
  canRevert: (entity: PostEntity) => boolean;
  revert: (entity: PostEntity) => void;
  removeProcess: (entity: PostEntity) => void;
  duplicate?: (entity: PostEntity) => void;
  remove?: (entity: PostEntity) => void;
}

export interface PhoneKanbanBoardProps {
  rows: BoardRow[];
  activeRowKey: string | null;
  onActiveRowKeyChange: (key: string) => void;
  displayMixed: (rowKey: string, ordem: number, column: BoardColumn) => BoardEntity[];
  sortModeFor: (colKey: string) => FluxosColumnSort;
  setColumnSort: (colKey: string, sort: FluxosColumnSort) => void;
  sensors: SensorDescriptor<SensorOptions>[];
  onDragStart: (e: DragStartEvent) => void;
  onDragOver: (e: DragOverEvent) => void;
  onDragEnd: (e: DragEndEvent) => void;
  onDragCancel: () => void;
  activeEntity: BoardEntity | null;
  membros: Membro[];
  onRefresh: () => void;
  countsFor: (workflowId: number) => WorkflowCardCounts;
  workflow: PhoneKanbanWorkflowActions;
  post: PhoneKanbanPostActions;
  onAddWorkflow?: (templateId: number | null) => void;
  onAddPostIndividual?: (templateId: number) => void;
  onCreateTemplate?: () => void;
  createTemplateDisabled?: boolean;
  postProcessesEnabled?: boolean;
}

function rowCount(row: BoardRow): number {
  return row.columns.reduce((sum, c) => sum + c.cards.length + c.posts.length, 0);
}

/** First etapa with something in it: opening on an empty Briefing column hides the work. */
function defaultOrdem(row: BoardRow): number | undefined {
  return (row.columns.find((c) => c.cards.length + c.posts.length > 0) ?? row.columns[0])?.ordem;
}

function PhoneSortableItem({
  id,
  reorder,
  children,
}: {
  id: string;
  reorder: boolean;
  children: (handle: ReactNode | undefined) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !reorder,
  });
  return (
    <li
      ref={setNodeRef}
      className="phone-ent-board__item"
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.3 : 1,
      }}
      {...(reorder ? attributes : {})}
    >
      {children(
        reorder ? <PhoneDragHandle label="Arrastar para reordenar" {...listeners} /> : undefined,
      )}
    </li>
  );
}

/**
 * The Fluxos board on phones (EntregasKanban mockup, D20): one etapa at a time with
 * chips, only the active column rendered, the template switch, the column sort, the
 * row's "+ Novo" and "Criar template". Moves stay adjacent-only through the board's
 * own stage commands (the ✓ button and the card menu); a hold opens the card menu,
 * and drag exists only in Reordenar mode, from the handle, inside the column.
 */
export function PhoneKanbanBoard({
  rows,
  activeRowKey,
  onActiveRowKeyChange,
  displayMixed,
  sortModeFor,
  setColumnSort,
  sensors,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDragCancel,
  activeEntity,
  membros,
  onRefresh,
  countsFor,
  workflow,
  post,
  onAddWorkflow,
  onAddPostIndividual,
  onCreateTemplate,
  createTemplateDisabled,
  postProcessesEnabled,
}: PhoneKanbanBoardProps) {
  const row = rows.find((r) => r.key === activeRowKey) ?? rows[0];
  const [ordemByRow, setOrdemByRow] = useState<Record<string, number>>({});
  const [reorder, setReorder] = useState(false);
  const [templateSheet, setTemplateSheet] = useState(false);
  const [sortSheet, setSortSheet] = useState(false);
  const [newSheet, setNewSheet] = useState(false);
  const templateButtonRef = useRef<HTMLButtonElement>(null);

  const chosenOrdem = row ? ordemByRow[row.key] : undefined;
  const column =
    row &&
    (row.columns.find((c) => c.ordem === chosenOrdem) ??
      row.columns.find((c) => c.ordem === defaultOrdem(row)));
  const colKey = row && column ? columnKey(row.key, column.ordem) : '';
  const mixed = useMemo(
    () => (row && column ? displayMixed(row.key, column.ordem, column) : []),
    [row, column, displayMixed],
  );
  if (!row || !column) return null;

  const sortMode = sortModeFor(colKey);
  const isFirstColumn = row.columns[0]?.ordem === column.ordem;
  const offersPostIndividual =
    row.templateId != null && postProcessesEnabled === true && !!onAddPostIndividual;
  const fluxos = column.cards.length;
  const posts = column.posts.length;
  const countLabel =
    fluxos > 0 && posts > 0
      ? `${fluxos} ${fluxos === 1 ? 'fluxo' : 'fluxos'} · ${posts} ${posts === 1 ? 'post' : 'posts'}`
      : String(fluxos + posts);
  const panelId = `phone-ent-col-${row.key.replace(/[^a-z0-9]/gi, '-')}`;

  const selectColumn = (ordem: number) => {
    setReorder(false);
    setOrdemByRow((prev) => ({ ...prev, [row.key]: ordem }));
  };

  const renderEntity = (entity: BoardEntity, handle: ReactNode | undefined) => {
    if (entity.kind === 'post') {
      return (
        <PostProcessCardMenu
          entity={entity}
          disabled={reorder}
          onOpen={post.open ? () => post.open!(entity) : undefined}
          onForward={() => post.forward(entity)}
          forwardLabel={post.forwardLabel(entity)}
          canRevert={post.canRevert(entity)}
          onRevert={() => post.revert(entity)}
          onRemoveProcess={() => post.removeProcess(entity)}
          onDuplicate={post.duplicate ? () => post.duplicate!(entity) : undefined}
          onDelete={post.remove ? () => post.remove!(entity) : undefined}
          preview={<PhonePostProcessCard entity={entity} preview />}
        >
          {({ triggerProps }) => (
            <PhonePostProcessCard
              entity={entity}
              onOpen={post.open ? () => post.open!(entity) : undefined}
              onForward={reorder ? undefined : () => post.forward(entity)}
              forwardLabel={post.forwardLabel(entity)}
              triggerProps={reorder ? undefined : triggerProps}
              dragHandle={handle}
            />
          )}
        </PostProcessCardMenu>
      );
    }
    const card = entity.card;
    const counts = countsFor(card.workflow.id!);
    return (
      <WorkflowCardMenu
        card={card}
        membros={membros}
        onRefresh={onRefresh}
        disabled={reorder}
        onOpenPosts={() => workflow.open(card)}
        onEdit={() => workflow.edit(card)}
        onForward={() => workflow.forward(card)}
        onRevert={() => workflow.revert(card)}
        onDuplicate={workflow.duplicate ? () => workflow.duplicate!(card) : undefined}
        onDelete={workflow.remove ? () => workflow.remove!(card) : undefined}
        preview={<PhoneWorkflowCard card={card} counts={counts} preview />}
      >
        {({ triggerProps }) => (
          <PhoneWorkflowCard
            card={card}
            counts={counts}
            onOpen={() => workflow.open(card)}
            onForward={reorder ? undefined : () => workflow.forward(card)}
            triggerProps={reorder ? undefined : triggerProps}
            dragHandle={handle}
          />
        )}
      </WorkflowCardMenu>
    );
  };

  return (
    <div className="phone-ent-board" data-testid="phone-kanban-board">
      <div className="phone-ent-board__bar">
        <button
          ref={templateButtonRef}
          type="button"
          className="phone-ent-board__template"
          aria-label={`Template: ${row.label}. Trocar template`}
          aria-haspopup="dialog"
          onClick={() => setTemplateSheet(true)}
        >
          <span>{row.label}</span>
          <ChevronDown aria-hidden="true" />
        </button>
        <ChipRow aria-label="Etapas" semantics="tablist" className="phone-ent-board__chips">
          {row.columns.map((c) => (
            <Chip
              key={c.ordem}
              label={c.nome}
              count={c.cards.length + c.posts.length}
              selected={c.ordem === column.ordem}
              controls={panelId}
              onClick={() => selectColumn(c.ordem)}
            />
          ))}
        </ChipRow>
      </div>

      <section
        id={panelId}
        role="tabpanel"
        aria-label={`${column.nome}, ${countLabel}`}
        className="phone-ent-board__column"
        {...(column.tipo === 'aprovacao_cliente' ? { 'data-tour': 'wf-col-aprovacao' } : {})}
      >
        <div className="phone-ent-board__head">
          <h2 className="phone-ent-board__title">
            {column.nome} <span>{countLabel}</span>
          </h2>
          <div className="phone-ent-board__head-actions">
            {reorder ? (
              <button
                type="button"
                className="phone-ent-text-btn phone-ent-text-btn--strong"
                onClick={() => setReorder(false)}
              >
                OK
              </button>
            ) : (
              <>
                {mixed.length > 1 && (
                  <button
                    type="button"
                    className="phone-ent-text-btn"
                    onClick={() => setReorder(true)}
                  >
                    Reordenar
                  </button>
                )}
                <button
                  type="button"
                  className="phone-ent-text-btn"
                  aria-label={`Ordenar coluna ${column.nome}: ${sortMode === 'prazo' ? 'Prazo' : 'Manual'}`}
                  onClick={() => setSortSheet(true)}
                >
                  <ArrowUpDown aria-hidden="true" />
                  {sortMode === 'prazo' ? 'Prazo' : 'Manual'}
                </button>
              </>
            )}
          </div>
        </div>
        {reorder && (
          <p className="phone-ent-board__hint" role="status">
            Arraste pela alça para mudar a ordem desta etapa.
          </p>
        )}

        {isFirstColumn && onAddWorkflow && !reorder && (
          <button
            type="button"
            className="phone-ent-board__add"
            onClick={() =>
              offersPostIndividual ? setNewSheet(true) : onAddWorkflow(row.templateId)
            }
          >
            <Plus aria-hidden="true" />
            {offersPostIndividual ? 'Novo' : 'Novo fluxo'}
          </button>
        )}

        <DndContext
          sensors={sensors}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={onDragCancel}
        >
          <SortableContext items={mixed.map(sortableIdOf)} strategy={verticalListSortingStrategy}>
            {mixed.length === 0 ? (
              <p className="phone-ent-board__empty">Nenhuma entrega</p>
            ) : (
              <ul className="phone-ent-board__list">
                {mixed.map((entity) => (
                  <PhoneSortableItem
                    key={sortableIdOf(entity)}
                    id={sortableIdOf(entity)}
                    reorder={reorder}
                  >
                    {(handle) => renderEntity(entity, handle)}
                  </PhoneSortableItem>
                ))}
              </ul>
            )}
          </SortableContext>
          <DragOverlay>
            {activeEntity?.kind === 'workflow' && (
              <PhoneWorkflowCard
                card={activeEntity.card}
                counts={countsFor(activeEntity.card.workflow.id!)}
                preview
              />
            )}
            {activeEntity?.kind === 'post' && (
              <PhonePostProcessCard entity={activeEntity} preview />
            )}
          </DragOverlay>
        </DndContext>
      </section>

      <ActionSheet
        open={templateSheet}
        onOpenChange={setTemplateSheet}
        title="Templates"
        message="Escolha o quadro de qual template ver."
        returnFocusRef={templateButtonRef}
        actions={[
          ...rows.map((r) => ({
            label: `${r.key === row.key ? '✓ ' : ''}${r.label} (${rowCount(r)})`,
            onSelect: () => {
              setReorder(false);
              onActiveRowKeyChange(r.key);
            },
          })),
          ...(onCreateTemplate
            ? [
                {
                  label: createTemplateDisabled
                    ? 'Criar template (limite do plano atingido)'
                    : 'Criar template',
                  icon: <Plus aria-hidden="true" />,
                  disabled: createTemplateDisabled,
                  onSelect: onCreateTemplate,
                },
              ]
            : []),
        ]}
      />
      <ActionSheet
        open={sortSheet}
        onOpenChange={setSortSheet}
        title={`Ordenar coluna ${column.nome}`}
        actions={(
          [
            ['prazo', 'Prazo'],
            ['manual', 'Manual'],
          ] as const
        ).map(([mode, label]) => ({
          label: `${sortMode === mode ? '✓ ' : ''}${label}`,
          onSelect: () => setColumnSort(colKey, mode),
        }))}
      />
      {onAddWorkflow && offersPostIndividual && (
        <ActionSheet
          open={newSheet}
          onOpenChange={setNewSheet}
          title={`Novo em ${row.label}`}
          actions={[
            { label: 'Fluxo', onSelect: () => onAddWorkflow(row.templateId) },
            {
              label: 'Post individual',
              onSelect: () => onAddPostIndividual!(row.templateId as number),
            },
          ]}
        />
      )}
    </div>
  );
}
