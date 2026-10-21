import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePhoneChrome } from '@/components/layout/PhoneLayoutContext';
import { PhoneIconButton } from './LargeTitleHeader';

export interface PhoneNavBarProps {
  /** Title in the bar. Omit it when the screen renders its own large title below. */
  title?: ReactNode;
  /** `center` is the iOS nav bar title; `leading` sits right after the back button. */
  titleAlign?: 'center' | 'leading';
  /** Heading level of the bar title. */
  titleAs?: 'h1' | 'h2' | 'span';
  /** Accessible name of the back button ("Voltar para Equipe"). */
  backLabel?: string;
  /** Replaces the default Back (history back, or `fallbackTo` when there is no history). */
  onBack?: () => void;
  /** Where Back goes when the screen was opened directly (deep link, reload, new tab). */
  fallbackTo?: string;
  /** Right side: round icon buttons or a text button ("Editar", "Salvar"). */
  trailing?: ReactNode;
  className?: string;
}

/** True when the router has an earlier in-app entry to go back to. */
function hasInAppHistory(): boolean {
  const idx = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof idx === 'number' && idx > 0;
}

/**
 * Nav bar of a pushed screen on phones (D26): back button, optional title, trailing
 * actions. A plain header that stays mounted with the screen, never a dialog (an open
 * `role="dialog"` would stall silent deploy swaps). While mounted it hides the shell's
 * bell bar, like `PhonePageHeader`.
 */
export function PhoneNavBar({
  title,
  titleAlign = 'center',
  titleAs: Title = 'h1',
  backLabel = 'Voltar',
  onBack,
  fallbackTo = '/dashboard',
  trailing,
  className,
}: PhoneNavBarProps) {
  usePhoneChrome({ pageHeader: true });
  const navigate = useNavigate();

  const goBack = () => {
    if (onBack) return onBack();
    if (hasInAppHistory()) navigate(-1);
    else navigate(fallbackTo, { replace: true });
  };

  return (
    <header
      className={cn(
        'phone-kit phone-nav-bar',
        title != null && `phone-nav-bar--title-${titleAlign}`,
        className,
      )}
    >
      <div className="phone-nav-bar__leading">
        <PhoneIconButton label={backLabel} onClick={goBack}>
          <ChevronLeft aria-hidden="true" />
        </PhoneIconButton>
        {title != null && <Title className="phone-nav-bar__title">{title}</Title>}
      </div>
      <div className="phone-nav-bar__trailing">{trailing}</div>
    </header>
  );
}
