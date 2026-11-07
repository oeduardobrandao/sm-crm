import { useEffect, useState } from 'react';
import { BellOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Cell, GroupedList } from '@/components/mobile/GroupedList';
import { getMesaasNative } from './mesaasNative';
import {
  enableNativePush,
  getPushPermission,
  isNativePushAvailable,
  type PushPermission,
} from './push';

export interface PushPermissionRowProps {
  /** `card` above the desktop matrix, `phone` as a grouped-list cell. */
  variant?: 'card' | 'phone';
  /** Called after iOS granted permission from this row. */
  onEnabled?: () => void;
}

/**
 * Notification preferences inside the app: says when iOS notifications are off on this
 * iPhone and offers the way back. Undecided → "Ativar" (the system dialog); denied →
 * "Abrir Ajustes" (iOS shows its dialog only once). Hidden when granted, on the web and on
 * a binary without the plugins.
 */
export function PushPermissionRow({ variant = 'card', onEnabled }: PushPermissionRowProps) {
  const { t } = useTranslation('common');
  const [permission, setPermission] = useState<PushPermission | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isNativePushAvailable()) return;
    let cancelled = false;
    const check = () => {
      void getPushPermission().then((next) => {
        if (!cancelled) setPermission(next);
      });
    };
    check();
    // Back from the Settings app: the switch may have changed there.
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (permission === null || permission === 'granted') return null;

  const denied = permission === 'denied';
  const actionLabel = denied ? t('native.pushOffSettings') : t('native.pushOffEnable');
  const onAction = async () => {
    if (busy) return;
    if (denied) {
      try {
        await getMesaasNative()?.openSettings();
      } catch {
        // Nothing to fall back to.
      }
      return;
    }
    setBusy(true);
    try {
      const result = await enableNativePush();
      setPermission(result);
      if (result === 'granted') onEnabled?.();
    } finally {
      setBusy(false);
    }
  };

  if (variant === 'phone') {
    return (
      <GroupedList>
        <Cell
          label={t('native.pushOffTitle')}
          value={actionLabel}
          chevron
          disabled={busy}
          onClick={() => void onAction()}
        />
      </GroupedList>
    );
  }

  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-[color:var(--border-color)] p-3">
      <span className="flex items-center gap-2 font-medium">
        <BellOff className="h-4 w-4 shrink-0 text-[color:var(--text-muted)]" aria-hidden="true" />
        {t('native.pushOffTitle')}
      </span>
      <Button
        size="sm"
        variant="outline"
        className="mb-0 shrink-0"
        disabled={busy}
        onClick={() => void onAction()}
      >
        {actionLabel}
      </Button>
    </div>
  );
}
