import { useTranslation } from 'react-i18next';
import type { Ideia } from '@/store';

const CLASSES: Record<Ideia['status'], string> = {
  nova: 'bg-stone-100 text-stone-600',
  em_analise: 'bg-yellow-100 text-yellow-700',
  aprovada: 'bg-green-100 text-green-700',
  descartada: 'bg-red-100 text-red-600',
  convertida: 'bg-blue-100 text-blue-700',
  concluida: 'bg-emerald-100 text-emerald-700',
};

export function IdeiaStatusBadge({ status }: { status: Ideia['status'] }) {
  const { t } = useTranslation('ideas');
  return (
    <span
      className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full ${CLASSES[status]}`}
    >
      {t(`status.${status}`)}
    </span>
  );
}
