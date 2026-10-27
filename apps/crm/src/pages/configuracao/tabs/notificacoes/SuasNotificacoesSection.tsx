import { useTranslation } from 'react-i18next';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonStatus } from '@/components/ui/skeletons';
import { CATEGORY_LABELS, isEmailEligibleType } from '@/lib/notification-catalog';
import { MASTER_PAUSE_TYPE } from '@/store/notificationPrefs';
import { enabledOf, useSuasNotificacoes } from './useSuasNotificacoes';

/** "Suas notificações": in-app x e-mail matrix for all catalog types,
 * grouped by category, plus a master "Pausar tudo" row per channel. */
export default function SuasNotificacoesSection() {
  const { t } = useTranslation('settings');
  const {
    loading,
    inappPrefs,
    emailPrefs,
    inappPaused,
    emailPaused,
    categories,
    saveInapp,
    saveEmail,
  } = useSuasNotificacoes();

  if (loading) {
    return (
      <SkeletonStatus className="card animate-up">
        <div className="mb-4 flex flex-col gap-2">
          <Skeleton className="h-5 w-44" />
          <Skeleton className="h-3.5 w-3/4" />
        </div>
        <div className="divide-y divide-[color:var(--border-color)]">
          {['52%', '64%', '46%', '58%', '50%'].map((w) => (
            <div key={w} className="grid grid-cols-[1fr_72px_72px] items-center gap-2 py-3">
              <div className="flex flex-col gap-1.5">
                <Skeleton className="h-3.5" style={{ width: w }} />
                <Skeleton className="h-3 w-1/3" />
              </div>
              <span className="flex justify-center">
                <Skeleton className="h-5 w-9 rounded-full" />
              </span>
              <span className="flex justify-center">
                <Skeleton className="h-5 w-9 rounded-full" />
              </span>
            </div>
          ))}
        </div>
      </SkeletonStatus>
    );
  }

  return (
    <div className="card animate-up">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">{t('notifications.suas.title')}</h2>
        <p className="text-sm text-[color:var(--text-muted)]">
          {t('notifications.suas.description')}
        </p>
      </div>

      <div className="grid grid-cols-[1fr_72px_72px] items-center gap-2 pb-2">
        <span />
        <span className="text-center text-xs font-medium text-[color:var(--text-muted)]">
          {t('notifications.inApp')}
        </span>
        <span className="text-center text-xs font-medium text-[color:var(--text-muted)]">
          {t('shared.email')}
        </span>
      </div>

      <div className="grid grid-cols-[1fr_72px_72px] items-center gap-2 rounded-lg bg-[color-mix(in_srgb,var(--warning)_15%,transparent)] p-3">
        <span className="font-medium">{t('notifications.pauseAll')}</span>
        <span className="flex justify-center">
          <Switch
            aria-label={t('notifications.pauseAllInApp')}
            checked={inappPaused}
            onCheckedChange={(v) => saveInapp({ type: MASTER_PAUSE_TYPE, enabled: !v })}
          />
        </span>
        <span className="flex justify-center">
          <Switch
            aria-label={t('notifications.pauseAllEmail')}
            checked={emailPaused}
            onCheckedChange={(v) => saveEmail({ type: MASTER_PAUSE_TYPE, enabled: !v })}
          />
        </span>
      </div>

      {categories.map(({ category, rows }) => (
        <div key={category} className="mt-4">
          <h3 className="mb-2 text-sm font-semibold text-[color:var(--text-main)]">
            {CATEGORY_LABELS[category]}
          </h3>
          <div className="divide-y divide-[color:var(--border-color)]">
            {rows.map((row) => {
              // Narrowed via the catalog-derived type guard, so the mutate call
              // below needs no cast to NotificationEmailType.
              const emailType = isEmailEligibleType(row.type) ? row.type : null;
              return (
                <div
                  key={row.type}
                  className="grid grid-cols-[1fr_72px_72px] items-center gap-2 py-3"
                >
                  <div>
                    <div className="font-medium">{row.label}</div>
                    <div className="text-sm text-[color:var(--text-muted)]">
                      {t('notifications.when', { when: row.when })}
                    </div>
                    <div className="text-sm text-[color:var(--text-muted)]">
                      {t('notifications.recipients', { recipients: row.recipients })}
                    </div>
                  </div>
                  <span className="flex justify-center">
                    <Switch
                      aria-label={t('notifications.rowInApp', { label: row.label })}
                      disabled={inappPaused}
                      checked={enabledOf(inappPrefs, row.type)}
                      onCheckedChange={(v) => saveInapp({ type: row.type, enabled: v })}
                    />
                  </span>
                  <span className="flex justify-center">
                    {emailType ? (
                      <Switch
                        aria-label={t('notifications.rowEmail', { label: row.label })}
                        disabled={emailPaused}
                        checked={enabledOf(emailPrefs, row.type)}
                        onCheckedChange={(v) => saveEmail({ type: emailType, enabled: v })}
                      />
                    ) : (
                      <span
                        className="text-center text-[color:var(--text-muted)]"
                        title={t('notifications.noEmailType')}
                        aria-label={t('notifications.noEmailTypeAria', { label: row.label })}
                      >
                        ·
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
