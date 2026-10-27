import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  ExternalLink,
  MoreHorizontal,
  Route,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { i18n } from '@mesaas/i18n';
import { SwipeRow, type SwipeAction } from '@/components/mobile/SwipeRow';
import {
  ContextMenu,
  type ContextMenuAction,
  type ContextMenuTriggerProps,
} from '@/components/mobile/ContextMenu';
import { copyAppLink } from '@/lib/copyAppLink';
import type { ActivePost } from '@/store';
import type { BoardCard } from '../hooks/useEntregasData';
import type { PostEntity } from '../boardEntity';
import type { ListGroup } from '../listGrouping';
import { forwardLabelFor, previousStepOf } from '../postProcessCommands';
import { usePhoneBoardActions } from './boardActions';
import { PostProcessCardMenu, WorkflowCardMenu } from './cardMenus';
import { PhonePostProcessCard, PhoneWorkflowCard } from './PhoneBoardCards';
import { workflowForwardLabel } from './phoneFormat';
import './listPhone.css';

/* Phone rendering of the Entregas Lista (fluxos + posts individuais) and of the
 * Publicações list (PLAN C3.6, D20): grouped white cards of swipe rows instead of
 * the sideways tables. The views keep the projection, the sort, the grouping and
 * the collapsed state; this file only draws them. */

/** What a row shows. The view builds it from the same projection as the table. */
export interface PhoneRowDisplay {
  title: string;
  /** "Cliente · Etapa · Responsável" (mockup). */
  subtitle: string;
  /** Third line: what the table shows in extra columns (fluxo, tipo, agendado). */
  meta?: string;
  /** Small tag before the subtitle ("Individual"). */
  tag?: ReactNode;
  /** Right side: status and deadline, compact. */
  aside?: ReactNode;
}

function PhoneListRowBody({
  display,
  onOpen,
  triggerProps,
  openMenuRef,
  hasSwipeActions = false,
}: {
  display: PhoneRowDisplay;
  /** Absent: the row is not openable (the table row has no click either). */
  onOpen?: () => void;
  triggerProps?: ContextMenuTriggerProps;
  /**
   * Filled with the menu's open function for the swipe "Mais" action. A function call,
   * not a click on the trigger: a click inside the row's content would go through
   * SwipeRow's click capture, which swallows it while the row is open or right after
   * a swipe.
   */
  openMenuRef?: RefObject<(() => void) | undefined>;
  /** The row has swipe actions, whose "Mais" is the keyboard path to the menu. */
  hasSwipeActions?: boolean;
}) {
  const { t } = useTranslation('entregasPhone');
  const openMenu = triggerProps?.onClick;
  useEffect(() => {
    if (openMenuRef) openMenuRef.current = openMenu;
  });
  const content = (
    <>
      <span className="phone-ent-l-row__text">
        <strong className="phone-ent-l-row__title">{display.title}</strong>
        <span className="phone-ent-l-row__subtitle">
          {display.tag}
          {display.subtitle}
        </span>
        {display.meta && <span className="phone-ent-l-row__meta">{display.meta}</span>}
      </span>
      {display.aside}
    </>
  );
  return (
    <div className="phone-ent-l-row__inner">
      {onOpen ? (
        <button type="button" className="phone-ent-l-row__main" onClick={onOpen}>
          {content}
        </button>
      ) : (
        <div className="phone-ent-l-row__main">{content}</div>
      )}
      {triggerProps && (
        // The menu's explicit trigger. Focus returns here when the menu closes (not to
        // the swipe "Mais", whose focus would slide the row open again). With swipe
        // actions it stays out of the tab order: "Mais" comes first in the row and a
        // click here while the row is open would only close the row.
        <button
          {...triggerProps}
          tabIndex={hasSwipeActions ? -1 : undefined}
          className="phone-ent-l-row__more"
          aria-label={t('shared.moreActions', { title: display.title })}
        >
          <MoreHorizontal aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function trailingActions(onMore: () => void, onForward?: () => void): SwipeAction[] {
  const out: SwipeAction[] = [
    {
      label: i18n.t('entregasPhone:list.more'),
      icon: <MoreHorizontal aria-hidden="true" />,
      tone: 'neutral',
      onAction: onMore,
    },
  ];
  if (onForward)
    out.push({
      label: i18n.t('entregasPhone:list.advance'),
      icon: <Check aria-hidden="true" />,
      tone: 'success',
      onAction: onForward,
    });
  return out;
}

/** Fluxo row: tap opens the fluxo, the menu is the fluxo card's menu. */
export function PhoneWorkflowListRow({
  card,
  display,
  onOpen,
}: {
  card: BoardCard;
  display: PhoneRowDisplay;
  onOpen: () => void;
}) {
  const actions = usePhoneBoardActions();
  const openMenuRef = useRef<(() => void) | undefined>(undefined);
  const wf = actions?.workflow;
  return (
    <SwipeRow
      as="li"
      className="phone-ent-l-row"
      trailingActions={
        wf
          ? trailingActions(
              () => openMenuRef.current?.(),
              () => wf.forward(card),
            )
          : undefined
      }
    >
      <WorkflowCardMenu
        card={card}
        membros={actions?.membros}
        onRefresh={actions?.onRefresh}
        onOpenPosts={wf ? () => wf.open(card) : onOpen}
        onEdit={wf ? () => wf.edit(card) : undefined}
        onForward={wf ? () => wf.forward(card) : undefined}
        onRevert={wf ? () => wf.revert(card) : undefined}
        onDuplicate={wf?.duplicate ? () => wf.duplicate?.(card) : undefined}
        onDelete={wf?.remove ? () => wf.remove?.(card) : undefined}
        preview={
          actions ? (
            <PhoneWorkflowCard card={card} counts={actions.countsFor(card.workflow.id!)} preview />
          ) : undefined
        }
      >
        {({ triggerProps }) => (
          <PhoneListRowBody
            display={display}
            onOpen={onOpen}
            triggerProps={triggerProps}
            openMenuRef={openMenuRef}
            hasSwipeActions={!!actions}
          />
        )}
      </WorkflowCardMenu>
    </SwipeRow>
  );
}

/** Post individual row: the same menu as its board card. */
export function PhonePostEntityListRow({
  entity,
  display,
  onOpen,
}: {
  entity: PostEntity;
  display: PhoneRowDisplay;
  onOpen?: () => void;
}) {
  const actions = usePhoneBoardActions();
  const openMenuRef = useRef<(() => void) | undefined>(undefined);
  const post = actions?.post;
  return (
    <SwipeRow
      as="li"
      className="phone-ent-l-row"
      trailingActions={
        post
          ? trailingActions(
              () => openMenuRef.current?.(),
              () => post.forward(entity),
            )
          : undefined
      }
    >
      <PostProcessCardMenu
        entity={entity}
        onOpen={post ? () => post.open(entity) : onOpen}
        onForward={post ? () => post.forward(entity) : undefined}
        forwardLabel={forwardLabelFor(entity.process)}
        canRevert={previousStepOf(entity.process) != null}
        onRevert={post ? () => post.revert(entity) : undefined}
        onRemoveProcess={post ? () => post.removeProcess(entity) : undefined}
        onDuplicate={post?.duplicate ? () => post.duplicate?.(entity) : undefined}
        onDelete={post?.remove ? () => post.remove?.(entity) : undefined}
        preview={actions ? <PhonePostProcessCard entity={entity} preview /> : undefined}
      >
        {({ triggerProps }) => (
          <PhoneListRowBody
            display={display}
            onOpen={onOpen}
            triggerProps={triggerProps}
            openMenuRef={openMenuRef}
            hasSwipeActions={!!actions}
          />
        )}
      </PostProcessCardMenu>
    </SwipeRow>
  );
}

/**
 * Publicações row. Avançar / Voltar act on the stage the post is in: its fluxo's
 * etapa for a wired post, its processo individual for an avulso, nothing otherwise.
 */
export function PhoneActivePostListRow({
  post,
  display,
  onOpen,
  onOpenFluxo,
}: {
  post: ActivePost;
  display: PhoneRowDisplay;
  /** Absent when the post's fluxo isn't an openable card (same gate as the table row). */
  onOpen?: () => void;
  /** The table's fluxo tag: present only when the fluxo card is loaded. */
  onOpenFluxo?: () => void;
}) {
  const { t } = useTranslation('entregasPhone');
  const actions = usePhoneBoardActions();
  const [menuOpen, setMenuOpen] = useState(false);
  const card = post.workflow_id != null ? actions?.cardOfPost(post) : undefined;
  const entity = post.workflow_id == null ? actions?.entityOfPost(post) : undefined;

  let onForward: (() => void) | undefined;
  const stage: ContextMenuAction[] = [];
  if (actions && card) {
    onForward = () => actions.workflow.forward(card);
    stage.push({
      label: workflowForwardLabel(card),
      icon: <Check aria-hidden="true" />,
      onSelect: onForward,
    });
    if (card.etapaIdx > 0)
      stage.push({
        label: t('shared.revertEtapa'),
        icon: <ArrowLeft aria-hidden="true" />,
        onSelect: () => actions.workflow.revert(card),
      });
  } else if (actions && entity) {
    onForward = () => actions.post.forward(entity);
    stage.push({
      label: forwardLabelFor(entity.process),
      icon: <Check aria-hidden="true" />,
      onSelect: onForward,
    });
    if (previousStepOf(entity.process) != null)
      stage.push({
        label: t('shared.revertEtapa'),
        icon: <ArrowLeft aria-hidden="true" />,
        onSelect: () => actions.post.revert(entity),
      });
  }

  const openFluxo =
    onOpenFluxo ?? (actions && card ? () => actions.workflow.open(card) : undefined);
  const open: ContextMenuAction[] = [];
  if (onOpen)
    open.push({
      label: t('list.openPost'),
      icon: <ExternalLink aria-hidden="true" />,
      onSelect: onOpen,
    });
  if (openFluxo)
    open.push({
      label: t('list.openFluxo'),
      icon: <Route aria-hidden="true" />,
      onSelect: openFluxo,
    });
  open.push({
    label: t('shared.copyPostLink'),
    icon: <Copy aria-hidden="true" />,
    onSelect: () => void copyAppLink(`/entregas?post=${post.id}`),
  });

  return (
    <SwipeRow
      as="li"
      className="phone-ent-l-row"
      trailingActions={actions ? trailingActions(() => setMenuOpen(true), onForward) : undefined}
    >
      <ContextMenu
        label={t('shared.postActions')}
        open={menuOpen}
        onOpenChange={setMenuOpen}
        sections={[stage, open].filter((s) => s.length > 0)}
        preview={
          <div className="phone-ent-l-preview">
            <PhoneListRowBody display={display} />
          </div>
        }
      >
        {({ triggerProps }) => (
          <PhoneListRowBody
            display={display}
            onOpen={onOpen}
            triggerProps={triggerProps}
            hasSwipeActions={!!actions}
          />
        )}
      </ContextMenu>
    </SwipeRow>
  );
}

/**
 * Sections of the phone list: one white card per group with a collapsible header,
 * "Fechar todos" / "Abrir todos" on the first header (ListGroupsToggle semantics),
 * or a single card when nothing groups the list.
 */
export function PhoneListSections<T>({
  label,
  groups,
  rows,
  renderRow,
  collapsed,
  onToggleGroup,
  allCollapsed,
  onToggleAll,
}: {
  /** Accessible name of each list card ("Entregas", "Posts"). */
  label: string;
  groups: ListGroup<T>[] | null;
  /** Ungrouped rows (used when `groups` is null). */
  rows: readonly T[];
  renderRow: (row: T) => ReactNode;
  collapsed: ReadonlySet<string>;
  onToggleGroup: (key: string) => void;
  allCollapsed: boolean;
  onToggleAll: () => void;
}) {
  const { t } = useTranslation('entregasPhone');
  if (!groups) {
    return (
      <div className="phone-ent-l animate-up">
        <ul className="phone-ent-l-list" aria-label={label}>
          {rows.map(renderRow)}
        </ul>
      </div>
    );
  }
  const ToggleIcon = allCollapsed ? ChevronsUpDown : ChevronsDownUp;
  return (
    <div className="phone-ent-l animate-up">
      {groups.map((g, i) => {
        const isCollapsed = collapsed.has(g.key);
        const name = `${g.label}${g.sub ? ` ${g.sub}` : ''}`;
        return (
          <section key={g.key} className="phone-ent-l-section">
            <div className="phone-ent-l-head">
              <h2 className="phone-ent-l-head__title">
                <button
                  type="button"
                  className="phone-ent-l-head__toggle"
                  data-danger={g.danger || undefined}
                  aria-expanded={!isCollapsed}
                  aria-label={`${name} (${g.rows.length})`}
                  onClick={() => onToggleGroup(g.key)}
                >
                  {isCollapsed ? (
                    <ChevronRight aria-hidden="true" />
                  ) : (
                    <ChevronDown aria-hidden="true" />
                  )}
                  <span className="phone-ent-l-head__label">
                    {g.label} · {g.rows.length}
                  </span>
                  {g.sub && <span className="phone-ent-l-head__sub">{g.sub}</span>}
                </button>
              </h2>
              {i === 0 && groups.length > 1 && (
                <button type="button" className="phone-ent-l-head__all" onClick={onToggleAll}>
                  <ToggleIcon aria-hidden="true" />
                  {allCollapsed ? t('list.expandAll') : t('list.collapseAll')}
                </button>
              )}
            </div>
            {!isCollapsed && (
              <ul className="phone-ent-l-list" aria-label={`${label}: ${name}`}>
                {g.rows.map(renderRow)}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** Right side of a row: a coloured status dot + label over a deadline line. */
export function PhoneRowAside({
  status,
  statusColor,
  deadline,
  overdue,
}: {
  status?: ReactNode;
  /** Dot colour (a CSS colour). Without it, `status` renders as given (e.g. a chip). */
  statusColor?: string;
  deadline?: string | null;
  overdue?: boolean;
}) {
  if (!status && !deadline) return null;
  return (
    <span className="phone-ent-l-aside">
      {status &&
        (statusColor ? (
          <span className="phone-ent-l-aside__status">
            <span
              className="phone-ent-l-aside__dot"
              style={{ background: statusColor }}
              aria-hidden="true"
            />
            {status}
          </span>
        ) : (
          status
        ))}
      {deadline && (
        <span className="phone-ent-l-aside__deadline" data-overdue={overdue || undefined}>
          {deadline}
        </span>
      )}
    </span>
  );
}
