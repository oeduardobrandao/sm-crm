import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface Props {
  title: ReactNode;
  /** Line under the title (counts). */
  subtitle?: ReactNode;
  /** Right of the title: a text link ("Calendário") or round icon buttons. */
  trailing?: ReactNode;
  tone?: 'danger';
  /** Between the header and the card (search field, filter chips). */
  toolbar?: ReactNode;
  /** Small print under the card. */
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
  'data-bucket'?: string;
  'data-testid'?: string;
}

/**
 * Inset-grouped section of the Início screen: the kit's GroupedList look, with room for
 * a trailing link or buttons next to the header (FInicio: "ATRASADO · 2  Calendário",
 * "SAÚDE DOS CLIENTES" with Buscar / Ordenar). Children are the `<li>` rows.
 */
export function PhoneSection({
  title,
  subtitle,
  trailing,
  tone,
  toolbar,
  footer,
  children,
  className,
  ...rest
}: Props) {
  const headerId = useId();
  return (
    <section className={cn('phone-kit phone-home-section', className)} {...rest}>
      <div className="phone-home-section__head">
        <div className="phone-home-section__titles">
          <h2
            id={headerId}
            className={cn(
              'phone-home-section__title',
              tone === 'danger' && 'phone-home-section__title--danger',
            )}
          >
            {title}
          </h2>
          {subtitle && <p className="phone-home-section__subtitle">{subtitle}</p>}
        </div>
        {trailing && <div className="phone-home-section__trailing">{trailing}</div>}
      </div>
      {toolbar}
      <ul className="phone-home-section__list" aria-labelledby={headerId}>
        {children}
      </ul>
      {footer && <p className="phone-home-section__footer">{footer}</p>}
    </section>
  );
}
