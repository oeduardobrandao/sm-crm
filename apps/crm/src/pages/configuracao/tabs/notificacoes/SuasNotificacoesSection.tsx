import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { Spinner } from '@/components/ui/spinner';
import {
  NOTIFICATION_CATALOG,
  CATEGORY_ORDER,
  CATEGORY_LABELS,
  isEmailEligibleType,
} from '@/lib/notification-catalog';
import {
  getNotificationEmailPrefs,
  setNotificationEmailPref,
  getNotificationInappPrefs,
  setNotificationInappPref,
  MASTER_PAUSE_TYPE,
  type NotificationEmailType,
} from '@/store/notificationPrefs';
import { INAPP_PREFS_KEY } from '@/hooks/useNotifications';
import type { NotificationType } from '@/store/notifications';

const INAPP_PREFS_QUERY_KEY = ['notification-inapp-prefs-page'];
const EMAIL_PREFS_QUERY_KEY = ['notification-email-prefs-page'];

/** Catalog entries flattened to rows, keeping declaration order (also the
 * within-category order, since the catalog is already grouped by category). */
const CATALOG_ROWS = (Object.keys(NOTIFICATION_CATALOG) as NotificationType[]).map((type) => ({
  type,
  ...NOTIFICATION_CATALOG[type],
}));

/** Sem linha = ligado (default on). */
const enabledOf = (prefs: Record<string, boolean> | undefined, type: string) =>
  prefs?.[type] !== false;

const SAVE_ERROR_MESSAGE = 'Não foi possível salvar. Tente novamente.';

/** "Suas notificações": in-app x e-mail matrix for all 22 catalog types,
 * grouped by category, plus a master "Pausar tudo" row per channel. */
export default function SuasNotificacoesSection() {
  const qc = useQueryClient();

  const { data: inappPrefs, isLoading: inappLoading } = useQuery({
    queryKey: INAPP_PREFS_QUERY_KEY,
    queryFn: getNotificationInappPrefs,
  });
  const { data: emailPrefs, isLoading: emailLoading } = useQuery({
    queryKey: EMAIL_PREFS_QUERY_KEY,
    queryFn: getNotificationEmailPrefs,
  });

  const saveInapp = useMutation({
    mutationFn: ({
      type,
      enabled,
    }: {
      type: NotificationType | typeof MASTER_PAUSE_TYPE;
      enabled: boolean;
    }) => setNotificationInappPref(type, enabled),
    onMutate: async (v) => {
      // Optimistic flip so the switch responds instantly instead of waiting
      // on the round trip; cancelQueries first so an in-flight refetch can't
      // clobber this optimistic write with stale data.
      await qc.cancelQueries({ queryKey: INAPP_PREFS_QUERY_KEY });
      const prev = qc.getQueryData<Record<string, boolean>>(INAPP_PREFS_QUERY_KEY);
      qc.setQueryData<Record<string, boolean>>(INAPP_PREFS_QUERY_KEY, (old) => ({
        ...(old ?? {}),
        [v.type]: v.enabled,
      }));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(INAPP_PREFS_QUERY_KEY, ctx.prev);
      toast.error(SAVE_ERROR_MESSAGE);
    },
    onSettled: () => {
      // The bell (popover + unread badge) reads its own prefs query and
      // notification lists: invalidate all of them so it reacts immediately.
      // onSettled (not onSuccess): if the prefs query had failed before this
      // save, onMutate captured no snapshot to roll back to, so a failed save
      // must also refetch to re-sync the cache with the server.
      qc.invalidateQueries({ queryKey: INAPP_PREFS_QUERY_KEY });
      qc.invalidateQueries({ queryKey: INAPP_PREFS_KEY });
      qc.invalidateQueries({ queryKey: ['notifications'] });
      qc.invalidateQueries({ queryKey: ['notifications-unread-count'] });
    },
  });

  const saveEmail = useMutation({
    mutationFn: ({
      type,
      enabled,
    }: {
      type: NotificationEmailType | typeof MASTER_PAUSE_TYPE;
      enabled: boolean;
    }) => setNotificationEmailPref(type, enabled),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: EMAIL_PREFS_QUERY_KEY });
      const prev = qc.getQueryData<Record<string, boolean>>(EMAIL_PREFS_QUERY_KEY);
      qc.setQueryData<Record<string, boolean>>(EMAIL_PREFS_QUERY_KEY, (old) => ({
        ...(old ?? {}),
        [v.type]: v.enabled,
      }));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(EMAIL_PREFS_QUERY_KEY, ctx.prev);
      toast.error(SAVE_ERROR_MESSAGE);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: EMAIL_PREFS_QUERY_KEY }),
  });

  if (inappLoading || emailLoading) {
    return (
      <div className="card animate-up flex justify-center p-8">
        <Spinner />
      </div>
    );
  }

  const inappPaused = !enabledOf(inappPrefs, MASTER_PAUSE_TYPE);
  const emailPaused = !enabledOf(emailPrefs, MASTER_PAUSE_TYPE);

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
            onCheckedChange={(v) => saveInapp.mutate({ type: MASTER_PAUSE_TYPE, enabled: !v })}
          />
        </span>
        <span className="flex justify-center">
          <Switch
            aria-label="Pausar tudo (e-mail)"
            checked={emailPaused}
            onCheckedChange={(v) => saveEmail.mutate({ type: MASTER_PAUSE_TYPE, enabled: !v })}
          />
        </span>
      </div>

      {CATEGORY_ORDER.map((category) => (
        <div key={category} className="mt-4">
          <h3 className="mb-2 text-sm font-semibold text-[color:var(--text-main)]">
            {CATEGORY_LABELS[category]}
          </h3>
          <div className="divide-y divide-[color:var(--border-color)]">
            {CATALOG_ROWS.filter((row) => row.category === category).map((row) => {
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
                      onCheckedChange={(v) => saveInapp.mutate({ type: row.type, enabled: v })}
                    />
                  </span>
                  <span className="flex justify-center">
                    {emailType ? (
                      <Switch
                        aria-label={`${row.label} (e-mail)`}
                        disabled={emailPaused}
                        checked={enabledOf(emailPrefs, row.type)}
                        onCheckedChange={(v) => saveEmail.mutate({ type: emailType, enabled: v })}
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
