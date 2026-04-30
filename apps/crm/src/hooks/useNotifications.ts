import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  dismissNotification,
  getNotifications,
  getUnreadNotificationCount,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  type Notification,
} from '../store';

const UNREAD_KEY = ['notifications-unread-count'] as const;
const LIST_KEY = ['notifications'] as const;
const REFETCH_INTERVAL = 60_000;
const STALE_TIME = 30_000;

export interface UseNotificationsOptions {
  popoverOpen: boolean;
}

export function useNotifications({ popoverOpen }: UseNotificationsOptions) {
  const qc = useQueryClient();

  const unreadQuery = useQuery({
    queryKey: UNREAD_KEY,
    queryFn: getUnreadNotificationCount,
    refetchInterval: REFETCH_INTERVAL,
    refetchOnWindowFocus: true,
    staleTime: STALE_TIME,
  });

  const listQuery = useQuery({
    queryKey: LIST_KEY,
    queryFn: () => getNotifications(50, 0),
    enabled: popoverOpen,
    refetchInterval: popoverOpen ? REFETCH_INTERVAL : false,
    refetchOnWindowFocus: true,
    staleTime: STALE_TIME,
  });

  const markAsRead = useMutation({
    mutationFn: (id: string) => markNotificationAsRead(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: LIST_KEY });
      const prev = qc.getQueryData<Notification[]>(LIST_KEY);
      qc.setQueryData<Notification[]>(LIST_KEY, (old) =>
        (old ?? []).map(n => n.id === id ? { ...n, read_at: new Date().toISOString() } : n));
      const prevCount = qc.getQueryData<number>(UNREAD_KEY) ?? 0;
      qc.setQueryData<number>(UNREAD_KEY, Math.max(0, prevCount - 1));
      return { prev, prevCount };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(LIST_KEY, ctx.prev);
      if (typeof ctx?.prevCount === 'number') qc.setQueryData(UNREAD_KEY, ctx.prevCount);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: LIST_KEY });
      qc.invalidateQueries({ queryKey: UNREAD_KEY });
    },
  });

  const markAllAsRead = useMutation({
    mutationFn: markAllNotificationsAsRead,
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: LIST_KEY });
      const prev = qc.getQueryData<Notification[]>(LIST_KEY);
      const now = new Date().toISOString();
      qc.setQueryData<Notification[]>(LIST_KEY, (old) =>
        (old ?? []).map(n => n.read_at ? n : { ...n, read_at: now }));
      qc.setQueryData<number>(UNREAD_KEY, 0);
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(LIST_KEY, ctx.prev);
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
      const prev = qc.getQueryData<Notification[]>(LIST_KEY);
      qc.setQueryData<Notification[]>(LIST_KEY, (old) =>
        (old ?? []).filter(n => n.id !== id));
      // If the dismissed item was unread, decrement the badge
      const wasUnread = (prev ?? []).find(n => n.id === id && !n.read_at);
      if (wasUnread) {
        const prevCount = qc.getQueryData<number>(UNREAD_KEY) ?? 0;
        qc.setQueryData<number>(UNREAD_KEY, Math.max(0, prevCount - 1));
      }
      return { prev };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(LIST_KEY, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: LIST_KEY });
      qc.invalidateQueries({ queryKey: UNREAD_KEY });
    },
  });

  return {
    notifications: listQuery.data ?? [],
    unreadCount: unreadQuery.data ?? 0,
    isLoading: listQuery.isLoading,
    markAsRead: markAsRead.mutate,
    markAllAsRead: markAllAsRead.mutate,
    dismiss: dismiss.mutate,
  };
}
