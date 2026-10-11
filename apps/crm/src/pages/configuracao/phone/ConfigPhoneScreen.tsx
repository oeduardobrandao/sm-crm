import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { PhoneNavBar } from '@/components/mobile/PhoneNavBar';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonStatus } from '@/components/ui/skeletons';
import './configPhone.css';

export interface ConfigPhoneScreenProps {
  /** Screen title, under the nav bar (28px, as the FConfig* mockups). */
  title: ReactNode;
  /** One line under the title. */
  subtitle?: ReactNode;
  /** Right side of the nav bar: round icon buttons or a text button ("Salvar"). */
  trailing?: ReactNode;
  /**
   * Back for an in-page sub-screen (`useConfigSubScreen().close`). Omitted on a tab's
   * own screen: Back goes through history, or to `/configuracao` on a deep link.
   */
  onBack?: () => void;
  backLabel?: string;
  /** Where Back goes when the tab was opened directly. */
  fallbackTo?: string;
  className?: string;
  children: ReactNode;
}

/**
 * A Configurações screen on phones: the pushed-screen nav bar (back plus the screen's
 * own actions), the title, then the screen's grouped lists. Every tab's phone branch
 * renders one; in-page sub-screens (a role, a member, a Hub section) render one with
 * `onBack` from `useConfigSubScreen`.
 */
export function ConfigPhoneScreen({
  title,
  subtitle,
  trailing,
  onBack,
  backLabel,
  fallbackTo = '/configuracao',
  className,
  children,
}: ConfigPhoneScreenProps) {
  return (
    <div className={cn('phone-kit phone-config-screen', className)}>
      <PhoneNavBar
        backLabel={backLabel ?? (onBack ? 'Voltar' : 'Voltar para Configurações')}
        onBack={onBack}
        fallbackTo={fallbackTo}
        trailing={trailing}
      />
      <div className="phone-config-screen__head">
        <h1 className="phone-config-screen__title">{title}</h1>
        {subtitle && <p className="phone-config-screen__subtitle">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

/** The text action of a nav bar ("Salvar"), right-aligned like iOS. */
export function ConfigNavTextButton({
  children,
  onClick,
  disabled,
  busy,
  'aria-label': ariaLabel,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  /** Shows the action as running and blocks repeat taps. */
  busy?: boolean;
  'aria-label'?: string;
}) {
  return (
    <button
      type="button"
      className="phone-config-nav-text"
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  );
}

/**
 * Grouped-list silhouette for a phone screen that is still loading: `groups` cards of
 * `rows` rows each. Announced once as "Carregando…".
 */
export function ConfigPhoneSkeleton({
  groups = 2,
  rows = 3,
  className,
}: {
  groups?: number;
  rows?: number;
  className?: string;
}) {
  return (
    <SkeletonStatus className={cn('phone-config-skeleton', className)}>
      {Array.from({ length: groups }, (_, g) => (
        <div key={g} className="phone-kit phone-group">
          <Skeleton className="phone-group__header h-3 w-24" />
          <div className="phone-group__list">
            {Array.from({ length: rows }, (_, r) => (
              <div key={r} className="phone-config-skeleton__row">
                <Skeleton className="h-[30px] w-[30px] shrink-0 rounded-lg" />
                <Skeleton className="h-4" style={{ width: `${55 + ((g + r) % 3) * 12}%` }} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </SkeletonStatus>
  );
}
