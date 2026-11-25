import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import { captureEvent } from '@/lib/analytics';
import { ADD_CARD_PATH, formatTrialDate } from '@/lib/reverseTrial';
import { isNativeApp } from '@/native/platform';

/**
 * Trial section of Plano e Cobrança during a running reverse trial (spec Part 3): end date, plan
 * and the same "Adicionar cartão" CTA as the banner. Text only inside the iOS app.
 */
export function ReverseTrialCobrancaSection({
  planName,
  endsAt,
}: {
  planName: string;
  endsAt: string;
}) {
  const { t } = useTranslation('billing');
  const date = formatTrialDate(endsAt);
  if (isNativeApp()) {
    return (
      <div className="card reverse-trial-cobranca">
        <p className="reverse-trial-cobranca__text">
          {t('reverseTrial.cobranca.native', { date })}
        </p>
      </div>
    );
  }
  return (
    <div className="card reverse-trial-cobranca">
      <Sparkles size={20} aria-hidden="true" className="reverse-trial-cobranca__icon" />
      <div className="reverse-trial-cobranca__body">
        <p className="reverse-trial-cobranca__title">{t('reverseTrial.cobranca.title')}</p>
        <p className="reverse-trial-cobranca__text">
          {t('reverseTrial.cobranca.body', { plan: planName, date })}
        </p>
      </div>
      <Link
        to={ADD_CARD_PATH}
        className="btn-primary reverse-trial-cobranca__cta"
        onClick={() => captureEvent('reverse_trial_add_card_clicked', { surface: 'cobranca' })}
      >
        {t('reverseTrial.addCard')}
      </Link>
    </div>
  );
}
