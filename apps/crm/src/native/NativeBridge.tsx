import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { markNotificationAsRead } from '../store/notifications';
import {
  attachNativePushListeners,
  enableNativePush,
  getPushPermission,
  handlePushTap,
  isNativePushAvailable,
  readPrePromptSnooze,
  shouldShowPrePrompt,
  snoozePrePrompt,
  syncNativePush,
} from './push';
import { PushPrePromptSheet } from './PushPrePromptSheet';

// The bell's query keys (hooks/useNotifications.ts): list and unread badge.
const BELL_QUERY_KEYS = [['notifications'], ['notifications-unread-count']] as const;

/**
 * The iOS app's glue inside the signed-in shell (AppLayout renders it only when
 * isNativeApp()): push listeners for this mount, the device's registration for the
 * current user, and the pre-prompt.
 */
export default function NativeBridge() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const navigateRef = useRef(navigate);
  const [promptOpen, setPromptOpen] = useState(false);

  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

  // Tap listener (retained by the bridge until consumed, so a tap that cold-started the
  // app arrives here once the shell mounts) plus the registration pair.
  useEffect(() => {
    const ready = attachNativePushListeners((data) =>
      handlePushTap(data, {
        navigate: (path) => navigateRef.current(path),
        markRead: markNotificationAsRead,
        refreshNotifications: () => {
          for (const queryKey of BELL_QUERY_KEYS) {
            void queryClient.invalidateQueries({ queryKey: [...queryKey] });
          }
        },
      }),
    );
    return () => {
      void ready.then((detach) => detach());
    };
  }, [queryClient]);

  // Every user change (and the first mount): move the device to this user, refresh the
  // token, then decide on the pre-prompt.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      await syncNativePush();
      if (cancelled || !isNativePushAvailable()) return;
      const permission = await getPushPermission();
      if (cancelled) return;
      setPromptOpen(shouldShowPrePrompt(permission, readPrePromptSnooze(), Date.now()));
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return (
    <PushPrePromptSheet
      open={promptOpen}
      onAllow={() => {
        setPromptOpen(false);
        void enableNativePush();
      }}
      onLater={() => {
        snoozePrePrompt(Date.now());
        setPromptOpen(false);
      }}
    />
  );
}
