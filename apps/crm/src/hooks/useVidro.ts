import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useWorkspaceLimits } from '@/hooks/useWorkspaceLimits';
import { captureEvent } from '@/lib/analytics';
import { applyVidro, isVidroAttributeSet, readOptOut, writeOptOut } from '@/lib/vidroLook';

/**
 * Desktop "Vidro" look state (spec D1-D3). Call ONLY in AppLayout: it owns the html attribute.
 * The flag is read as `=== true` and only from a successful workspace-limits response; while that
 * is loading or after it failed, the attribute the pre-paint script set from the cache stands.
 */
export function useVidro() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { features, isSuccess, isLoading } = useWorkspaceLimits();
  // Last resolved value: seeded from the pre-paint attribute, updated on every successful response.
  // A failed (re)fetch keeps it, so the shell never flips (and never remounts the page) on a 5xx.
  const [resolved, setResolved] = useState(isVidroAttributeSet);
  const [optedOut, setOptedOutState] = useState(() => readOptOut(userId));

  useEffect(() => {
    setOptedOutState(readOptOut(userId));
  }, [userId]);

  const flag = features?.feature_crm_vidro === true;
  useEffect(() => {
    if (isSuccess) setResolved(flag);
  }, [isSuccess, flag]);

  const enabled = isSuccess ? flag : resolved;
  const active = enabled && !optedOut;

  useEffect(() => {
    if (isSuccess) applyVidro(active, userId);
  }, [isSuccess, active, userId]);

  const setOptedOut = useCallback(
    (v: boolean) => {
      if (!userId) return;
      writeOptOut(userId, v);
      setOptedOutState(v);
      applyVidro(enabled && !v, userId);
      captureEvent('vidro_look_toggled', { on: !v });
    },
    [userId, enabled],
  );

  // settled: the first workspace-limits answer (or failure) is in, so `active` is final for this load.
  return { enabled, active, optedOut, setOptedOut, settled: !isLoading };
}
