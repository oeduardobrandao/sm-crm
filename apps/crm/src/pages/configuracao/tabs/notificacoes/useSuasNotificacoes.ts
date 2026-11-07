import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { i18n } from '@mesaas/i18n';
import { NOTIFICATION_CATALOG, CATEGORY_ORDER, catalogText } from '@/lib/notification-catalog';
import {
  getNotificationEmailPrefs,
  setNotificationEmailPref,
  getNotificationInappPrefs,
  setNotificationInappPref,
  getNotificationPushPrefs,
  setNotificationPushPref,
  hasActivePushDevice,
  MASTER_PAUSE_TYPE,
  type NotificationEmailType,
  type NotificationPushType,
} from '@/store/notificationPrefs';
import { isNativeApp } from '@/native/platform';
import { INAPP_PREFS_KEY } from '@/hooks/useNotifications';
import { useWorkspaceLimits } from '@/hooks/useWorkspaceLimits';
import type { NotificationType } from '@/store/notifications';

const INAPP_PREFS_QUERY_KEY = ['notification-inapp-prefs-page'];
const EMAIL_PREFS_QUERY_KEY = ['notification-email-prefs-page'];
const PUSH_PREFS_QUERY_KEY = ['notification-push-prefs-page'];
/** Whether the user has an active push device (web only; inside the app it is moot). */
export const PUSH_DEVICE_QUERY_KEY = ['push-device-active'];

/** Catalog entries flattened to rows, keeping declaration order (also the
 * within-category order, since the catalog is already grouped by category). */
export const CATALOG_ROWS = (Object.keys(NOTIFICATION_CATALOG) as NotificationType[]).map(
  (type) => ({
    type,
    ...NOTIFICATION_CATALOG[type],
  }),
);

export type CatalogRow = (typeof CATALOG_ROWS)[number];

/** Sem linha = ligado (default on). */
export const enabledOf = (prefs: Record<string, boolean> | undefined, type: string) =>
  prefs?.[type] !== false;

/**
 * State and saves of "Suas notificações" (sino x e-mail x celular per catalog type
 * plus a master "Pausar tudo" per channel). Shared by the desktop section and the
 * phone screen, so both write through the same optimistic mutations.
 *
 * The Celular (push) channel is visible inside the iOS app, or on the web once the
 * user has an active device: someone who never installed the app has nothing to set.
 */
export function useSuasNotificacoes() {
  const qc = useQueryClient();
  // The agenda_* types only make sense where the Agenda exists (feature_agenda). Hidden
  // here, not in the catalog: an old notification still renders in the bell.
  const { features } = useWorkspaceLimits();
  const agendaAtiva = features?.feature_agenda === true;

  const { data: inappPrefs, isLoading: inappLoading } = useQuery({
    queryKey: INAPP_PREFS_QUERY_KEY,
    queryFn: getNotificationInappPrefs,
  });
  const { data: emailPrefs, isLoading: emailLoading } = useQuery({
    queryKey: EMAIL_PREFS_QUERY_KEY,
    queryFn: getNotificationEmailPrefs,
  });

  const native = isNativeApp();
  const { data: hasDevice, isLoading: deviceLoading } = useQuery({
    queryKey: PUSH_DEVICE_QUERY_KEY,
    queryFn: hasActivePushDevice,
    enabled: !native,
  });
  const pushVisible = native || hasDevice === true;
  // Fetched alongside the other two (not after the device check) so the column
  // doesn't make a second loading round; a small table, read once per visit.
  const { data: pushPrefs, isLoading: pushLoading } = useQuery({
    queryKey: PUSH_PREFS_QUERY_KEY,
    queryFn: getNotificationPushPrefs,
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
      toast.error(i18n.t('settings:notifications.saveError'));
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
      toast.error(i18n.t('settings:notifications.saveError'));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: EMAIL_PREFS_QUERY_KEY }),
  });

  const savePush = useMutation({
    mutationFn: ({
      type,
      enabled,
    }: {
      type: NotificationPushType | typeof MASTER_PAUSE_TYPE;
      enabled: boolean;
    }) => setNotificationPushPref(type, enabled),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: PUSH_PREFS_QUERY_KEY });
      const prev = qc.getQueryData<Record<string, boolean>>(PUSH_PREFS_QUERY_KEY);
      qc.setQueryData<Record<string, boolean>>(PUSH_PREFS_QUERY_KEY, (old) => ({
        ...(old ?? {}),
        [v.type]: v.enabled,
      }));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(PUSH_PREFS_QUERY_KEY, ctx.prev);
      toast.error(i18n.t('settings:notifications.saveError'));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: PUSH_PREFS_QUERY_KEY }),
  });

  /** Categories in display order, each with its visible rows; empty ones dropped (no
   * "Agenda" header when every row of the category is hidden). Row copy (label, when,
   * recipients) is resolved here, at render, in the current UI language. */
  const categories = CATEGORY_ORDER.map((category) => ({
    category,
    rows: CATALOG_ROWS.filter(
      (row) => row.category === category && (agendaAtiva || row.category !== 'agenda'),
    ).map((row) => ({ ...row, ...catalogText(row.type) })),
  })).filter((group) => group.rows.length > 0);

  return {
    // The device check gates the layout (two or three columns), so it holds the
    // skeleton too: the column never pops in after the table rendered.
    loading:
      inappLoading || emailLoading || (!native && deviceLoading) || (pushVisible && pushLoading),
    inappPrefs,
    emailPrefs,
    pushPrefs,
    inappPaused: !enabledOf(inappPrefs, MASTER_PAUSE_TYPE),
    emailPaused: !enabledOf(emailPrefs, MASTER_PAUSE_TYPE),
    pushPaused: !enabledOf(pushPrefs, MASTER_PAUSE_TYPE),
    pushVisible,
    categories,
    saveInapp: saveInapp.mutate,
    saveEmail: saveEmail.mutate,
    savePush: savePush.mutate,
  };
}
