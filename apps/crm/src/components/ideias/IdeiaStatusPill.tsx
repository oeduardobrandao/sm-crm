import { useTranslation } from 'react-i18next';
import type { Ideia } from '@/store';
import './ideiaPhone.css';

/** Phone face of `IdeiaStatusBadge`: the FIdeias pill, with dark-mode colours. */
export function IdeiaStatusPill({ status }: { status: Ideia['status'] }) {
  const { t } = useTranslation('ideas');
  return (
    <span className={`phone-ideia-pill phone-ideia-pill--${status}`}>
      {t(`status.${status}`, { defaultValue: status })}
    </span>
  );
}
