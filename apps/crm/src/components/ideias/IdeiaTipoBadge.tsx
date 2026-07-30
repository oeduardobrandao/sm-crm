import type { Ideia } from '@/store';

const LABELS: Record<Ideia['tipo'], string> = {
  ideia: 'Ideia',
  solicitacao: 'Solicitação',
};

const CLASSES: Record<Ideia['tipo'], string> = {
  ideia: 'bg-stone-100 text-stone-500',
  solicitacao: 'bg-primary/15 text-yellow-700',
};

export function IdeiaTipoBadge({ tipo }: { tipo: Ideia['tipo'] }) {
  return (
    <span
      className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full ${CLASSES[tipo]}`}
    >
      {LABELS[tipo]}
    </span>
  );
}
