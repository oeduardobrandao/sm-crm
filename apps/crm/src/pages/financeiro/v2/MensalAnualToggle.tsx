import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

interface MensalAnualToggleProps {
  anual: boolean;
  onChange: (anual: boolean) => void;
  className?: string;
}

const OPCOES = [
  { anual: false, key: 'mensal' },
  { anual: true, key: 'anual' },
] as const;

/** Segmented "Mensal | Anual" switch of the Rentabilidade table: two toggle buttons. */
export function MensalAnualToggle({ anual, onChange, className }: MensalAnualToggleProps) {
  const { t } = useTranslation('financeV2');
  return (
    <div
      role="group"
      aria-label={t('toggle.groupLabel')}
      className={cn('inline-flex gap-0.5 rounded-[10px] bg-muted p-[3px]', className)}
    >
      {OPCOES.map((o) => {
        const ativo = o.anual === anual;
        return (
          <button
            key={o.key}
            type="button"
            aria-pressed={ativo}
            onClick={() => onChange(o.anual)}
            className={cn(
              'flex-1 rounded-lg px-3.5 py-1.5 text-[13px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
              ativo
                ? 'bg-card font-semibold text-foreground shadow-sm'
                : 'font-medium text-muted-foreground hover:text-foreground',
            )}
          >
            {t(`toggle.${o.key}`)}
          </button>
        );
      })}
    </div>
  );
}

export default MensalAnualToggle;
