import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHubLook } from '../hooks/useHubLook';

export interface HubAccountMenuProps {
  person: { nome: string; email: string };
  onSignOut: () => void;
  /** Where the panel opens: below and right-aligned (top bar) or above and left-aligned (sidebar footer). */
  placement?: 'below-end' | 'above-start';
  /** Trigger diameter in px. 44 meets the touch target; the desktop sidebar uses a denser 32. */
  size?: number;
}

function initialsOf(nome: string, email: string): string {
  const words = nome.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return (email.trim()[0] ?? '?').toUpperCase();
  const first = words[0][0];
  const last = words.length > 1 ? words[words.length - 1][0] : '';
  return `${first}${last}`.toUpperCase();
}

/** Round initials button that opens a small card with who is signed in and "Sair". */
export function HubAccountMenu({
  person,
  onSignOut,
  placement = 'below-end',
  size = 44,
}: HubAccountMenuProps) {
  const { t } = useTranslation();
  const pauta = useHubLook() === 'pauta';
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    const onPointer = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('touchstart', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('touchstart', onPointer);
    };
  }, [open]);

  const panelPosition =
    placement === 'above-start' ? 'bottom-full left-0 mb-2' : 'top-full right-0 mt-2';

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-label={t('hub.account.menuLabel', { name: person.nome || person.email })}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
        style={{ width: size, height: size }}
        className={`flex items-center justify-center border hub-border hub-bg-card hub-txt text-[13px] font-semibold ${
          pauta ? 'rounded-[var(--hub-r-ctl)]' : 'rounded-full'
        }`}
      >
        {initialsOf(person.nome, person.email)}
      </button>
      {open && (
        <div
          id={panelId}
          className={`hub-fade-up absolute z-50 w-[260px] p-4 flex flex-col gap-4 hub-card ${panelPosition}`}
        >
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="font-semibold text-[14px] hub-txt truncate">{person.nome}</span>
            <span className="text-[13px] hub-tx2 truncate">{person.email}</span>
          </div>
          <div className="h-px hub-bg-soft" />
          <button
            type="button"
            onClick={onSignOut}
            className={`w-full min-h-[44px] px-4 text-[14px] font-medium hub-btn-secondary ${
              pauta ? 'rounded-[var(--hub-r-ctl)]' : 'rounded-xl'
            }`}
          >
            {t('hub.account.signOut')}
          </button>
        </div>
      )}
    </div>
  );
}
