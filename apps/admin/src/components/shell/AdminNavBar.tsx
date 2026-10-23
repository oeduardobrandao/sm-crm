import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { PhoneIconButton } from '@mesaas/ios-kit';
import { cn } from '../../lib/utils';

export interface AdminNavBarProps {
  title?: ReactNode;
  /** `onClick`, when set, replaces the back navigation. */
  back: { to: string; label: string; onClick?: () => void };
  trailing?: ReactNode;
}

function hasInAppHistory(): boolean {
  const idx = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof idx === 'number' && idx > 0;
}

/** Pushed-screen nav bar on phones: back, centred title, trailing actions. Never a dialog. */
export function AdminNavBar({ title, back, trailing }: AdminNavBarProps) {
  const navigate = useNavigate();
  const goBack = () => {
    if (back.onClick) back.onClick();
    else if (hasInAppHistory()) navigate(-1);
    else navigate(back.to, { replace: true });
  };
  return (
    <header
      className={cn('phone-kit phone-nav-bar', title != null && 'phone-nav-bar--title-center')}
    >
      <div className="phone-nav-bar__leading">
        <PhoneIconButton label={`Voltar para ${back.label}`} onClick={goBack}>
          <ChevronLeft aria-hidden="true" />
        </PhoneIconButton>
        {title != null && <h1 className="phone-nav-bar__title">{title}</h1>}
      </div>
      <div className="phone-nav-bar__trailing">{trailing}</div>
    </header>
  );
}
