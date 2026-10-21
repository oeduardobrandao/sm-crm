import { Hourglass } from 'lucide-react';

export interface AwaitingApprovalBadgeProps {
  /** Nome da aprovação que o post ainda espera (ex.: "Aprovação da Mídia"). */
  approvalName: string;
}

/**
 * Selo informativo (sem ação): o cliente aprovou, mas o fluxo tem outra
 * aprovação pela frente, então o agendamento automático só acontece na última.
 * Quem decide a visibilidade é o caller (shouldShowAwaitingApproval).
 */
export function AwaitingApprovalBadge({ approvalName }: AwaitingApprovalBadgeProps) {
  const title = `Este cliente agenda automaticamente, mas só depois da última aprovação. Aguardando: ${approvalName}.`;
  return (
    <span
      className="auto-schedule-badge auto-schedule-badge--waiting"
      title={title}
      aria-label={title}
    >
      <Hourglass className="h-3 w-3" aria-hidden="true" /> Aguarda aprovação
    </span>
  );
}
