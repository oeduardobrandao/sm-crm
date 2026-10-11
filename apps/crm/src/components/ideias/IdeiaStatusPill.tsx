import type { Ideia } from '@/store';
import { IDEIA_STATUS_LABELS } from '@/pages/ideias/ideiaLabels';
import './ideiaPhone.css';

/** Phone face of `IdeiaStatusBadge`: the FIdeias pill, with dark-mode colours. */
export function IdeiaStatusPill({ status }: { status: Ideia['status'] }) {
  return (
    <span className={`phone-ideia-pill phone-ideia-pill--${status}`}>
      {IDEIA_STATUS_LABELS[status] ?? status}
    </span>
  );
}
