import { useTranslation } from 'react-i18next';
import type { Ideia } from '@/store';

const CLASSES: Record<Ideia['tipo'], string> = {
  ideia: 'bg-stone-100 text-stone-500',
  solicitacao: 'bg-primary/15 text-yellow-700',
};

export function IdeiaTipoBadge({ tipo }: { tipo: Ideia['tipo'] }) {
  const { t } = useTranslation('ideas');
  return (
    <span
      className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full ${CLASSES[tipo]}`}
    >
      {t(`tipo.${tipo}`)}
    </span>
  );
}
