import { useTranslation } from 'react-i18next';
import { CORRECTION_REASONS } from '../lib/postHistory';
import type { CorrectionReason } from '../types';

const FALLBACK_LABELS: Record<CorrectionReason, string> = {
  midia: 'Mídia',
  texto: 'Texto',
  legenda: 'Legenda',
  outro: 'Outro',
};

interface CorrectionReasonChipsProps {
  value: CorrectionReason | null;
  onChange: (value: CorrectionReason | null) => void;
  disabled?: boolean;
}

/** Four fixed reasons, optional; clicking the selected chip again deselects it. */
export function CorrectionReasonChips({ value, onChange, disabled }: CorrectionReasonChipsProps) {
  const { t } = useTranslation('hubPosts');
  return (
    <div
      role="group"
      aria-label={t('correctionReason.title', 'Motivo da correção')}
      className="flex flex-nowrap gap-1.5 overflow-x-auto"
    >
      {CORRECTION_REASONS.map((reason) => {
        const selected = value === reason;
        return (
          <button
            key={reason}
            type="button"
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => onChange(selected ? null : reason)}
            className="shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors disabled:opacity-50"
            style={
              selected
                ? {
                    background: 'var(--hub-acc)',
                    color: 'var(--hub-acc-fg)',
                    borderColor: 'var(--hub-acc)',
                  }
                : { color: 'var(--hub-tx2)', borderColor: 'var(--hub-bd)' }
            }
          >
            {t(`correctionReason.${reason}`, FALLBACK_LABELS[reason])}
          </button>
        );
      })}
    </div>
  );
}
