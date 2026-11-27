import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

const NEXT_UP_SECONDS = 5;

interface NextUpOverlayProps {
  title: string;
  onGo: () => void;
  onCancel: () => void;
}

export function NextUpOverlay({ title, onGo, onCancel }: NextUpOverlayProps) {
  const { t } = useTranslation('help');
  const [remaining, setRemaining] = useState(NEXT_UP_SECONDS);
  const onGoRef = useRef(onGo);
  useEffect(() => {
    onGoRef.current = onGo;
  });

  // A single interval (not a chain of setTimeout re-scheduled per tick) so a big jump in fake
  // timers -- act(() => vi.advanceTimersByTime(4_000)) -- fires every tick synchronously in one
  // pass instead of only the first, since a re-scheduled setTimeout needs a render in between to
  // exist at all.
  useEffect(() => {
    const timer = setInterval(() => setRemaining((r) => (r > 0 ? r - 1 : 0)), 1000);
    return () => clearInterval(timer);
  }, []);

  const firedRef = useRef(false);
  useEffect(() => {
    if (remaining <= 0 && !firedRef.current) {
      firedRef.current = true;
      onGoRef.current();
    }
  }, [remaining]);

  return (
    <div
      role="status"
      className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/75 p-6 text-center text-white"
    >
      <p className="text-[0.75rem] uppercase tracking-wider text-white/70">
        {t('video.inSeconds', { seconds: Math.max(remaining, 0) })}
      </p>
      <p className="text-[1.05rem] font-semibold">{t('video.nextUp', { title })}</p>
      <div className="flex gap-2">
        <Button size="sm" onClick={onGo}>
          {t('video.watchNow')}
        </Button>
        <Button size="sm" variant="outline" className="text-foreground" onClick={onCancel}>
          {t('video.cancel')}
        </Button>
      </div>
    </div>
  );
}
