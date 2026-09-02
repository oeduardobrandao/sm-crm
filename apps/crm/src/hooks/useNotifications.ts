import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  dismissNotification,
  getNotifications,
  getUnreadNotificationCount,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  type Notification,
} from '../store/notifications';
import { getNotificationInappPrefs, mutedInappTypes } from '../store/notificationPrefs';

const UNREAD_KEY = ['notifications-unread-count'] as const;
const LIST_KEY = ['notifications'] as const;
const PREFS_KEY = ['notification-inapp-prefs'] as const;
/** Exported so Task 7's pref-save UI can invalidate it. */
export const INAPP_PREFS_KEY = PREFS_KEY;
const REFETCH_INTERVAL = 60_000;
const STALE_TIME = 30_000;

export interface UseNotificationsOptions {
  popoverOpen: boolean;
}

export function useNotifications({ popoverOpen }: UseNotificationsOptions) {
  const qc = useQueryClient();

  const prefsQuery = useQuery({
    queryKey: PREFS_KEY,
    queryFn: getNotificationInappPrefs,
    staleTime: 5 * 60_000,
    retry: 1,
  });
  // fail-open: an error fetching prefs means no filter (never hide by mistake)
  const muted = prefsQuery.isError ? [] : mutedInappTypes(prefsQuery.data ?? {});
  const masterPaused = muted === 'all';
  const excludeTypes = masterPaused ? [] : (muted as string[]);
  const prefsReady = prefsQuery.isSuccess || prefsQuery.isError;

  const unreadQuery = useQuery({
    queryKey: [...UNREAD_KEY, excludeTypes],
    queryFn: () => getUnreadNotificationCount(excludeTypes),
    enabled: prefsReady && !masterPaused,
    refetchInterval: REFETCH_INTERVAL,
    refetchOnWindowFocus: true,
    staleTime: STALE_TIME,
  });

  const listQuery = useQuery({
    queryKey: [...LIST_KEY, excludeTypes],
    queryFn: () => getNotifications(50, 0, excludeTypes),
    enabled: popoverOpen && prefsReady && !masterPaused,
    refetchInterval: popoverOpen ? REFETCH_INTERVAL : false,
    refetchOnWindowFocus: true,
    staleTime: STALE_TIME,
  });

  const markAsRead = useMutation({
    mutationFn: (id: string) => markNotificationAsRead(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: LIST_KEY });
      const prev = qc.getQueryData<Notification[]>([...LIST_KEY, excludeTypes]);
      qc.setQueryData<Notification[]>([...LIST_KEY, excludeTypes], (old) =>
        (old ?? []).map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)),
      );
      const prevCount = qc.getQueryData<number>([...UNREAD_KEY, excludeTypes]) ?? 0;
      qc.setQueryData<number>([...UNREAD_KEY, excludeTypes], Math.max(0, prevCount - 1));
      return { prev, prevCount };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData([...LIST_KEY, excludeTypes], ctx.prev);
      if (typeof ctx?.prevCount === 'number')
        qc.setQueryData([...UNREAD_KEY, excludeTypes], ctx.prevCount);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: LIST_KEY });
      qc.invalidateQueries({ queryKey: UNREAD_KEY });
    },
  });

  const markAllAsRead = useMutation({
    mutationFn: () => (masterPaused ? Promise.resolve() : markAllNotificationsAsRead(excludeTypes)),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: LIST_KEY });
      const prev = qc.getQueryData<Notification[]>([...LIST_KEY, excludeTypes]);
      const now = new Date().toISOString();
      qc.setQueryData<Notification[]>([...LIST_KEY, excludeTypes], (old) =>
        (old ?? []).map((n) => (n.read_at ? n : { ...n, read_at: now })),
      );
      qc.setQueryData<number>([...UNREAD_KEY, excludeTypes], 0);
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData([...LIST_KEY, excludeTypes], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: LIST_KEY });
      qc.invalidateQueries({ queryKey: UNREAD_KEY });
    },
  });

  const dismiss = useMutation({
    mutationFn: (id: string) => dismissNotification(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: LIST_KEY });
      const prev = qc.getQueryData<Notification[]>([...LIST_KEY, excludeTypes]);
      qc.setQueryData<Notification[]>([...LIST_KEY, excludeTypes], (old) =>
        (old ?? []).filter((n) => n.id !== id),
      );
      // If the dismissed item was unread, decrement the badge
      const wasUnread = (prev ?? []).find((n) => n.id === id && !n.read_at);
      if (wasUnread) {
        const prevCount = qc.getQueryData<number>([...UNREAD_KEY, excludeTypes]) ?? 0;
        qc.setQueryData<number>([...UNREAD_KEY, excludeTypes], Math.max(0, prevCount - 1));
      }
      return { prev };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData([...LIST_KEY, excludeTypes], ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: LIST_KEY });
      qc.invalidateQueries({ queryKey: UNREAD_KEY });
    },
  });

  return {
    notifications: masterPaused ? [] : (listQuery.data ?? []),
    unreadCount: masterPaused ? 0 : (unreadQuery.data ?? 0),
    isLoading: listQuery.isLoading,
    markAsRead: markAsRead.mutate,
    markAllAsRead: markAllAsRead.mutate,
    dismiss: dismiss.mutate,
  };
}
