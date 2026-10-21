import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonStatus } from '@/components/ui/skeletons';
import { CATEGORY_LABELS, isEmailEligibleType } from '@/lib/notification-catalog';
import { MASTER_PAUSE_TYPE } from '@/store/notificationPrefs';
import { enabledOf, useSuasNotificacoes } from './useSuasNotificacoes';

/** "Suas notificações": in-app x e-mail matrix for all catalog types,
 * grouped by category, plus a master "Pausar tudo" row per channel. */
export default function SuasNotificacoesSection() {
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
        <h2 className="text-lg font-semibold">Suas notificações</h2>
        <p className="text-sm text-[color:var(--text-muted)]">
          O que aparece no sino e o que chega no seu e-mail. Preferência individual: vale só para
          você.
        </p>
      </div>

      <div className="grid grid-cols-[1fr_72px_72px] items-center gap-2 pb-2">
        <span />
        <span className="text-center text-xs font-medium text-[color:var(--text-muted)]">
          No app
        </span>
        <span className="text-center text-xs font-medium text-[color:var(--text-muted)]">
          E-mail
        </span>
      </div>

      <div className="grid grid-cols-[1fr_72px_72px] items-center gap-2 rounded-lg bg-[color-mix(in_srgb,var(--warning)_15%,transparent)] p-3">
        <span className="font-medium">Pausar tudo</span>
        <span className="flex justify-center">
          <Switch
            aria-label="Pausar tudo (no app)"
            checked={inappPaused}
            onCheckedChange={(v) => saveInapp({ type: MASTER_PAUSE_TYPE, enabled: !v })}
          />
        </span>
        <span className="flex justify-center">
          <Switch
            aria-label="Pausar tudo (e-mail)"
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
                    <div className="text-sm text-[color:var(--text-muted)]">Quando: {row.when}</div>
                    <div className="text-sm text-[color:var(--text-muted)]">
                      Quem recebe: {row.recipients}
                    </div>
                  </div>
                  <span className="flex justify-center">
                    <Switch
                      aria-label={`${row.label} (no app)`}
                      disabled={inappPaused}
                      checked={enabledOf(inappPrefs, row.type)}
                      onCheckedChange={(v) => saveInapp({ type: row.type, enabled: v })}
                    />
                  </span>
                  <span className="flex justify-center">
                    {emailType ? (
                      <Switch
                        aria-label={`${row.label} (e-mail)`}
                        disabled={emailPaused}
                        checked={enabledOf(emailPrefs, row.type)}
                        onCheckedChange={(v) => saveEmail({ type: emailType, enabled: v })}
                      />
                    ) : (
                      <span
                        className="text-center text-[color:var(--text-muted)]"
                        title="Este tipo não vira e-mail"
                        aria-label={`${row.label}: este tipo não vira e-mail`}
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
