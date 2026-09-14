import { EyeOff } from 'lucide-react';
import type { Ideia } from '@/store';

const LABELS: Record<Ideia['origem'], string> = { cliente: 'Cliente', agencia: 'Agência' };
const CLASSES: Record<Ideia['origem'], string> = {
  cliente: 'bg-card text-stone-600 border border-border',
  agencia: 'bg-amber-50 text-amber-800 border border-amber-200',
};

export function IdeiaOrigemBadge({
  origem,
  hidden,
}: {
  origem: Ideia['origem'];
  hidden?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full ${CLASSES[origem]}`}
      >
        {LABELS[origem]}
      </span>
      {hidden && (
        <span
          title="Oculta do Hub"
          aria-label="Oculta do Hub"
          className="text-muted-foreground inline-flex"
        >
          <EyeOff size={13} />
        </span>
      )}
    </span>
  );
}
