import type { Ideia } from '@/store';

const LABELS: Record<Ideia['status'], string> = {
  nova: 'Nova',
  em_analise: 'Em análise',
  aprovada: 'Aprovada',
  descartada: 'Descartada',
};

const CLASSES: Record<Ideia['status'], string> = {
  nova: 'bg-stone-100 text-stone-600',
  em_analise: 'bg-yellow-100 text-yellow-700',
  aprovada: 'bg-green-100 text-green-700',
  descartada: 'bg-red-100 text-red-600',
};

export function IdeiaStatusBadge({ status }: { status: Ideia['status'] }) {
  return (
    <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full ${CLASSES[status]}`}>
      {LABELS[status]}
    </span>
  );
}
