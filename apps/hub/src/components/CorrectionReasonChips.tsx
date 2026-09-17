import { useTranslation } from 'react-i18next';
import { CORRECTION_REASONS } from '../lib/postHistory';
import type { CorrectionReason } from '../types';

const FALLBACK_LABELS: Record<CorrectionReason, string> = {
  legenda: 'Legenda',
  imagem_video: 'Imagem/vídeo',
  data: 'Data',
  outro: 'Outro',
};

interface CorrectionReasonChipsProps {
  value: CorrectionReason | null;
  onChange: (value: CorrectionReason) => void;
  disabled?: boolean;
}

/** Four fixed reasons; required by hub-approve (and the DB CHECK) on every correcao. */
export function CorrectionReasonChips({ value, onChange, disabled }: CorrectionReasonChipsProps) {
  const { t } = useTranslation('hubPosts');
  return (
    <div
      role="group"
      aria-label={t('correctionReason.title', 'Motivo da correção')}
      className="flex flex-wrap gap-1.5"
    >
      {CORRECTION_REASONS.map((reason) => {
        const selected = value === reason;
        return (
          <button
            key={reason}
            type="button"
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => onChange(reason)}
            className="rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors disabled:opacity-50"
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
