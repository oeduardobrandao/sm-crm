import type { ReactNode } from 'react';
import { Check, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SwipeRow, type SwipeAction } from '@/components/mobile/SwipeRow';
import { ContextMenu, type ContextMenuAction } from '@/components/mobile/ContextMenu';
import './phoneCrud.css';

export interface PhoneCrudRowSelection {
  /** False: the row can't be picked (it stays visible, dimmed, with an empty check slot). */
  selectable: boolean;
  selected: boolean;
  onToggle: () => void;
  /** Accessible name of the checkbox ("Selecionar Clínica Sol"). */
  label: string;
}

export interface PhoneCrudRowProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Third line (a period, dates). */
  meta?: ReactNode;
  /** Semibold title (Contratos), as the mockup draws record names. */
  strongTitle?: boolean;
  /** Disclosure chevron after the aside, for rows that open a screen or a sheet. */
  chevron?: boolean;
  /** Before the text: icon tile or avatar. */
  leading?: ReactNode;
  /** Right side: amount, status pill. */
  aside?: ReactNode;
  /** Tapping the row. Absent: the row isn't openable. */
  onOpen?: () => void;
  /** Revealed by swiping left. The buttons are always in the DOM (keyboard path). */
  swipeActions?: SwipeAction[];
  /** Long-press menu: accessible name and groups of actions. */
  menuLabel?: string;
  menuSections?: ContextMenuAction[][];
  /** Selection mode: the row becomes a checkbox; swipe and long-press are off. */
  selection?: PhoneCrudRowSelection;
  className?: string;
}

/**
 * One row of the phone CRUD lists (Financeiro, Contratos, Equipe, FFinanceiro /
 * FContratos / FEquipe mockups): leading tile, two text lines, an aside, swipe actions
 * and the same actions on a long-press menu. Render it inside a `GroupedList`.
 */
export function PhoneCrudRow({
  title,
  subtitle,
  meta,
  strongTitle,
  chevron,
  leading,
  aside,
  onOpen,
  swipeActions,
  menuLabel,
  menuSections,
  selection,
  className,
}: PhoneCrudRowProps) {
  const body = (
    <>
      {leading}
      <span className="phone-crud-row__text">
        <span
          className={cn('phone-crud-row__title', strongTitle && 'phone-crud-row__title--strong')}
        >
          {title}
        </span>
        {subtitle && <span className="phone-crud-row__subtitle">{subtitle}</span>}
        {meta && <span className="phone-crud-row__subtitle">{meta}</span>}
      </span>
      {aside && <span className="phone-crud-row__aside">{aside}</span>}
      {chevron && !selection && (
        <ChevronRight className="phone-crud-row__chevron" aria-hidden="true" />
      )}
    </>
  );

  if (selection) {
    const check = (
      <span
        className={cn(
          'phone-crud-row__check',
          selection.selected && 'phone-crud-row__check--on',
          !selection.selectable && 'phone-crud-row__check--none',
        )}
        aria-hidden="true"
      >
        {selection.selected && <Check />}
      </span>
    );
    return (
      <li className={cn('phone-crud-row', className)}>
        {selection.selectable ? (
          <button
            type="button"
            role="checkbox"
            aria-checked={selection.selected}
            aria-label={selection.label}
            className="phone-crud-row__main"
            onClick={selection.onToggle}
          >
            {check}
            {body}
          </button>
        ) : (
          <div className="phone-crud-row__main phone-crud-row__main--inert">
            {check}
            {body}
          </div>
        )}
      </li>
    );
  }

  const main = onOpen ? (
    <button type="button" className="phone-crud-row__main" onClick={onOpen}>
      {body}
    </button>
  ) : (
    <div className="phone-crud-row__main">{body}</div>
  );

  const hasMenu = Boolean(menuLabel && menuSections && menuSections.some((s) => s.length > 0));

  return (
    <SwipeRow as="li" className={cn('phone-crud-row', className)} trailingActions={swipeActions}>
      {hasMenu ? (
        <ContextMenu label={menuLabel!} sections={menuSections!.filter((s) => s.length > 0)}>
          {main}
        </ContextMenu>
      ) : (
        main
      )}
    </SwipeRow>
  );
}

/** Small rounded status label on the right of a row ("Pago", "Vigente"). */
export function PhoneStatusPill({
  tone = 'neutral',
  children,
}: {
  tone?: 'success' | 'warning' | 'neutral' | 'outline';
  children: ReactNode;
}) {
  return <span className={cn('phone-crud-pill', `phone-crud-pill--${tone}`)}>{children}</span>;
}
