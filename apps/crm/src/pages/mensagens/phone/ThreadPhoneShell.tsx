import type { ReactNode } from 'react';
import { PhoneNavBar } from '@/components/mobile/PhoneNavBar';
import { usePhoneChrome } from '@/components/layout/PhoneLayoutContext';
import './mensagensPhone.css';

/**
 * Frame of every `/mensagens/:clienteId` screen on phones (the thread and its loading,
 * error and not-found states): a full-bleed column with the nav bar on top. The tab bar
 * is hidden while it is mounted, so the composer sits at the bottom edge.
 */
export function ThreadPhoneShell({
  title,
  trailing,
  children,
}: {
  title: ReactNode;
  /** Right side of the nav bar (e.g. the team chat's details button). */
  trailing?: ReactNode;
  children: ReactNode;
}) {
  usePhoneChrome({ pageHeader: true, tabBar: false });
  return (
    <div className="page-full-bleed phone-msg-thread">
      <PhoneNavBar
        className="phone-msg-thread__bar"
        title={title}
        titleAlign="leading"
        backLabel="Voltar para as conversas"
        fallbackTo="/mensagens"
        trailing={trailing}
      />
      {children}
    </div>
  );
}
