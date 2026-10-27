import { useTranslation } from 'react-i18next';
import { Switch } from '@/components/ui/switch';
import { marketingLabel, transactionalRows, useEmailsAutomaticos } from './useEmailsAutomaticos';

/** "E-mails automáticos": transparency list of the account's transactional
 * emails (always on, no switch) plus the one email that IS opt-in, marketing,
 * wired to the same `profiles.marketing_opt_in` field as PerfilTab. */
export default function EmailsAutomaticosSection() {
  const { t } = useTranslation('settings');
  const { marketingOptIn, saveMarketing } = useEmailsAutomaticos();
  const marketing = marketingLabel();

  return (
    <div className="card animate-up">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">{t('notifications.emails.title')}</h2>
        <p className="text-sm text-[color:var(--text-muted)]">
          {t('notifications.emails.description')}
        </p>
      </div>

      <div className="divide-y divide-[color:var(--border-color)]">
        {transactionalRows().map((row) => (
          <div key={row.label} className="grid grid-cols-[1fr_96px] items-center gap-2 py-3">
            <div>
              <div className="font-medium">{row.label}</div>
              <div className="text-sm text-[color:var(--text-muted)]">
                {t('notifications.when', { when: row.when })}
              </div>
              <div className="text-sm text-[color:var(--text-muted)]">
                {t('notifications.recipients', { recipients: row.recipients })}
              </div>
            </div>
            <span className="text-center text-sm text-[color:var(--text-muted)]">
              {t('notifications.always')}
            </span>
          </div>
        ))}

        <div className="grid grid-cols-[1fr_96px] items-center gap-2 py-3">
          <div>
            <div className="font-medium">{marketing}</div>
            <div className="text-sm text-[color:var(--text-muted)]">
              {t('notifications.when', { when: t('notifications.marketingWhen') })}
            </div>
            <div className="text-sm text-[color:var(--text-muted)]">
              {t('notifications.recipients', {
                recipients: t('notifications.marketingRecipients'),
              })}
            </div>
            <div className="text-sm text-[color:var(--text-muted)]">
              {t('notifications.emails.sameControl')}
            </div>
          </div>
          <span className="flex justify-center">
            <Switch
              aria-label={marketing}
              checked={marketingOptIn}
              onCheckedChange={(v) => saveMarketing(v)}
            />
          </span>
        </div>
      </div>
    </div>
  );
}
