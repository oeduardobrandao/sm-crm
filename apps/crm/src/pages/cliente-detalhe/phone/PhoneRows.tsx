import { useId, type ReactNode } from 'react';
import { ChevronRight, ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { i18n } from '@mesaas/i18n';
import { cn } from '@/lib/utils';
import { SwipeRow, type SwipeAction } from '@/components/mobile/SwipeRow';
import { ContextMenu, type ContextMenuAction } from '@/components/mobile/ContextMenu';
import { sanitizeUrl } from '@/utils/security';
import './clienteDetalhePhone.css';

/**
 * A grouped section with an optional "+" next to its header (Links úteis, Datas,
 * Endereços in the FClienteVisaoGeral mockup). Children are `PhoneRow`s; `empty` shows
 * instead of the card when there are none.
 */
export function PhoneSectionList({
  title,
  addLabel,
  onAdd,
  empty,
  footer,
  className,
  children,
}: {
  title: ReactNode;
  /** Accessible name of the "+" button. */
  addLabel?: string;
  onAdd?: () => void;
  /** Shown in place of the rows when there are none. */
  empty?: ReactNode;
  footer?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  const headerId = useId();
  const hasRows = Array.isArray(children)
    ? children.some((c) => c != null && c !== false)
    : children != null && children !== false;
  return (
    <section className={cn('phone-kit phone-group phone-cli-list', className)}>
      <div className="phone-cli-list__head">
        <h2 id={headerId} className="phone-group__header phone-cli-list__title">
          {title}
        </h2>
        {onAdd && (
          <button
            type="button"
            className="phone-cli-list__add"
            aria-label={addLabel}
            onClick={onAdd}
          >
            <Plus aria-hidden="true" />
          </button>
        )}
      </div>
      {hasRows ? (
        <ul className="phone-group__list phone-cli-list__rows" aria-labelledby={headerId}>
          {children}
        </ul>
      ) : (
        empty
      )}
      {footer && <p className="phone-group__footer">{footer}</p>}
    </section>
  );
}

/** The empty state of a `PhoneSectionList`: a quiet card with one or two lines. */
export function PhoneEmptyCard({ title, hint }: { title: ReactNode; hint?: ReactNode }) {
  return (
    <div className="phone-cli-empty">
      <p className="phone-cli-empty__title">{title}</p>
      {hint && <p className="phone-cli-empty__hint">{hint}</p>}
    </div>
  );
}

export interface PhoneRowAction {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  destructive?: boolean;
}

/** Editar + Remover, the menu of every editable row in these screens. */
export function editRemoveActions(onEdit: () => void, onRemove: () => void): PhoneRowAction[] {
  return [
    { label: i18n.t('common:actions.edit'), icon: <Pencil aria-hidden="true" />, onSelect: onEdit },
    {
      label: i18n.t('common:actions.delete'),
      icon: <Trash2 aria-hidden="true" />,
      onSelect: onRemove,
      destructive: true,
    },
  ];
}

/**
 * One row with actions behind it: swipe left reveals them (and Tab reaches them, see
 * SwipeRow), a long-press opens the same actions as a menu (one owner per hold: there is
 * no drag on these rows). Tapping the row opens `href` in a new tab or runs `onOpen`.
 */
export function PhoneRow({
  title,
  subtitle,
  meta,
  leading,
  trailing,
  href,
  onOpen,
  menuLabel,
  actions = [],
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Third line (a domain, a date). */
  meta?: ReactNode;
  leading?: ReactNode;
  /** Replaces the chevron / external-link mark. */
  trailing?: ReactNode;
  href?: string;
  onOpen?: () => void;
  /** Accessible name of the long-press menu ("Ações do link Google Drive"). */
  menuLabel?: string;
  actions?: PhoneRowAction[];
  className?: string;
}) {
  const { t } = useTranslation('clients');
  const body = (
    <>
      {leading && (
        <span className="phone-cli-row__leading" aria-hidden="true">
          {leading}
        </span>
      )}
      <span className="phone-cli-row__body">
        <span className="phone-cli-row__text">
          <span className="phone-cli-row__title">{title}</span>
          {subtitle && <span className="phone-cli-row__subtitle">{subtitle}</span>}
          {meta && <span className="phone-cli-row__meta">{meta}</span>}
        </span>
        {trailing ??
          (href ? (
            <ExternalLink className="phone-cli-row__mark" aria-hidden="true" />
          ) : onOpen ? (
            <ChevronRight className="phone-cli-row__mark" aria-hidden="true" />
          ) : null)}
      </span>
    </>
  );

  const main = href ? (
    <a
      className="phone-cli-row__main"
      href={sanitizeUrl(href)}
      target="_blank"
      rel="noopener noreferrer"
    >
      {body}
    </a>
  ) : onOpen ? (
    <button type="button" className="phone-cli-row__main" onClick={onOpen}>
      {body}
    </button>
  ) : (
    <div className="phone-cli-row__main">{body}</div>
  );

  if (actions.length === 0) {
    return <li className={cn('phone-cli-row phone-cli-row--plain', className)}>{main}</li>;
  }

  const swipe: SwipeAction[] = actions.map((a) => ({
    label: a.label,
    icon: a.icon,
    tone: a.destructive ? 'destructive' : 'neutral',
    onAction: a.onSelect,
  }));
  const menu: ContextMenuAction[] = actions.map((a) => ({
    label: a.label,
    icon: a.icon,
    destructive: a.destructive,
    onSelect: a.onSelect,
  }));

  return (
    <SwipeRow as="li" className={cn('phone-cli-row', className)} trailingActions={swipe}>
      <ContextMenu label={menuLabel ?? t('phoneRows.actions')} sections={[menu]}>
        {main}
      </ContextMenu>
    </SwipeRow>
  );
}

/**
 * A `Cell`-looking row that opens an external URL in a new tab (`Cell to` renders a
 * router link). Sanitized like every href built from stored data.
 */
export function ExternalLinkCell({
  label,
  value,
  href,
}: {
  label: ReactNode;
  value?: ReactNode;
  href: string;
}) {
  return (
    <li className="phone-cell">
      <a
        className="phone-cell__main"
        href={sanitizeUrl(href)}
        target="_blank"
        rel="noopener noreferrer"
      >
        <span className="phone-cell__body">
          <span className="phone-cell__text">
            <span className="phone-cell__label">{label}</span>
          </span>
          {value != null && <span className="phone-cell__value">{value}</span>}
          <ExternalLink className="phone-cell__chevron" aria-hidden="true" />
        </span>
      </a>
    </li>
  );
}
