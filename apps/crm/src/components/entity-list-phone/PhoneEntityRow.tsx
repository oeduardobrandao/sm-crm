import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, MoreHorizontal } from 'lucide-react';
import {
  ContextMenu,
  type ContextMenuAction,
  type ContextMenuTriggerProps,
} from '@/components/mobile/ContextMenu';
import { SwipeRow, type SwipeAction } from '@/components/mobile/SwipeRow';
import './entityListPhone.css';

export interface PhoneEntityRowProps {
  /** Name of the record, for the menu trigger's accessible name ("Mais ações de …"). */
  title: string;
  /** What the row shows (avatar, two lines, a badge). Rendered inside the tap target. */
  children: ReactNode;
  /** Route the row opens: the whole row is a link with a chevron. */
  to?: string;
  /** Tap action when the row has no route (Leads open the edit form). */
  onOpen?: () => void;
  /** Accessible name of the long-press menu ("Ações do cliente"). */
  menuLabel: string;
  /** Menu groups; empty groups are dropped. No actions at all = no menu. */
  menuSections: ContextMenuAction[][];
  /** Lifted copy of the row above the menu. Defaults to the row's own content. */
  preview?: ReactNode;
  leadingActions?: SwipeAction[];
  trailingActions?: SwipeAction[];
  /**
   * Prepends a "Mais" swipe action that opens the menu. Needed when the menu holds
   * actions the swipe doesn't (it is then also the keyboard path to the menu).
   */
  moreAction?: boolean;
}

function RowBody({
  title,
  children,
  to,
  onOpen,
  triggerProps,
  openMenuRef,
  hasSwipeActions,
}: {
  title: string;
  children: ReactNode;
  to?: string;
  onOpen?: () => void;
  triggerProps?: ContextMenuTriggerProps;
  openMenuRef: RefObject<(() => void) | undefined>;
  hasSwipeActions: boolean;
}) {
  const openMenu = triggerProps?.onClick;
  useEffect(() => {
    openMenuRef.current = openMenu;
  });
  const content = (
    <>
      <span className="phone-el-row__content">{children}</span>
      {to && <ChevronRight className="phone-el-row__chevron" aria-hidden="true" />}
    </>
  );
  return (
    <div className="phone-el-row__inner">
      {to ? (
        <Link to={to} className="phone-el-row__main">
          {content}
        </Link>
      ) : onOpen ? (
        <button type="button" className="phone-el-row__main" onClick={onOpen}>
          {content}
        </button>
      ) : (
        <div className="phone-el-row__main">{content}</div>
      )}
      {triggerProps && (
        // The menu's explicit trigger and the place focus returns to when it closes.
        // With swipe actions it stays out of the tab order: those buttons (a "Mais"
        // among them when the menu has more) come first in the row, and a click here
        // while the row is slid open would only close the row.
        <button
          {...triggerProps}
          tabIndex={hasSwipeActions ? -1 : undefined}
          className="phone-el-row__more"
          aria-label={`Mais ações de ${title}`}
        >
          <MoreHorizontal aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/**
 * One row of a phone entity list (Clientes, Leads): a whole-row tap target inside a
 * swipe row, with a long-press menu over it. Same shape as the Entregas list rows:
 * `SwipeRow as="li"` → `ContextMenu` → the row body, so a hold opens the menu, a
 * horizontal swipe reveals the actions and a tap opens the record.
 */
export function PhoneEntityRow({
  title,
  children,
  to,
  onOpen,
  menuLabel,
  menuSections,
  preview,
  leadingActions = [],
  trailingActions = [],
  moreAction = false,
}: PhoneEntityRowProps) {
  const openMenuRef = useRef<(() => void) | undefined>(undefined);
  const sections = menuSections.filter((s) => s.length > 0);
  const hasMenu = sections.length > 0;
  const trailing: SwipeAction[] =
    hasMenu && moreAction
      ? [
          {
            label: 'Mais',
            icon: <MoreHorizontal aria-hidden="true" />,
            tone: 'neutral',
            onAction: () => openMenuRef.current?.(),
          },
          ...trailingActions,
        ]
      : trailingActions;
  const hasSwipeActions = leadingActions.length > 0 || trailing.length > 0;

  const body = (triggerProps?: ContextMenuTriggerProps) => (
    <RowBody
      title={title}
      to={to}
      onOpen={onOpen}
      triggerProps={triggerProps}
      openMenuRef={openMenuRef}
      hasSwipeActions={hasSwipeActions}
    >
      {children}
    </RowBody>
  );

  return (
    <SwipeRow
      as="li"
      className="phone-el-row"
      leadingActions={leadingActions}
      trailingActions={trailing}
    >
      {hasMenu ? (
        <ContextMenu
          label={menuLabel}
          sections={sections}
          preview={<div className="phone-kit phone-el-preview">{preview ?? children}</div>}
        >
          {({ triggerProps }) => body(triggerProps)}
        </ContextMenu>
      ) : (
        body()
      )}
    </SwipeRow>
  );
}
