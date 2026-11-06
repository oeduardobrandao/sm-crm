import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { toast } from 'sonner';
import { PopupCard } from '@mesaas/ui/PopupCard';
import { Dialog, DialogOverlay, DialogPortal } from '@/components/ui/dialog';
import { useGuide } from '@/components/guide/GuideContext';
import { captureEvent } from '@/lib/analytics';
import { writeIntroSeen } from '@/lib/vidroLook';
import { sanitizeUrl } from '@/utils/security';

const IMAGE = {
  light: '/vidro-intro-light.webp',
  dark: '/vidro-intro-dark.webp',
};

/**
 * Launch announcement of the Vidro look. AppLayout mounts it instead of GlobalPopupHost for the
 * session it is due in, so the two never stack. Yields to the onboarding guide the same way the
 * popup host does: an owner whose guide is about to open is new and has nothing to compare with.
 */
export default function VidroIntro({
  userId,
  onClassic,
  openDelayMs = 800,
}: {
  userId: string;
  onClassic: () => void;
  openDelayMs?: number;
}) {
  const { t } = useTranslation('common');
  const guide = useGuide();
  const [open, setOpen] = useState(false);
  const decided = useRef(false);
  const titleId = useId();
  const bodyId = useId();

  const guideState = guide?.autoOpen ?? 'no';
  const guideOpen = guide?.isOpen ?? false;

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // Decided once: a later guide change must not cancel the pending open.
  useEffect(() => {
    if (decided.current || guideState === 'unknown') return;
    decided.current = true;
    if (guideState === 'yes' || guideOpen) {
      writeIntroSeen(userId);
      return;
    }
    timer.current = setTimeout(() => {
      setOpen(true);
      writeIntroSeen(userId);
      captureEvent('vidro_intro_shown');
    }, openDelayMs);
  }, [guideState, guideOpen, userId, openDelayMs]);

  const dismiss = (how: 'continue' | 'close') => {
    captureEvent('vidro_intro_dismissed', { how });
    setOpen(false);
  };

  const goClassic = () => {
    setOpen(false);
    onClassic();
    toast.success(t('vidroIntro.classicToast.title'), {
      description: t('vidroIntro.classicToast.description'),
    });
  };

  const dark = document.documentElement.getAttribute('data-theme') === 'dark';

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) dismiss('close');
      }}
    >
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-1/2 z-[9011] w-[calc(100%-32px)] max-w-[420px] -translate-x-1/2 -translate-y-1/2 outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
          aria-labelledby={titleId}
          aria-describedby={bodyId}
        >
          {/* Same reason as GlobalPopupHost: the card renders the visible h2. */}
          <DialogPrimitive.Title asChild>
            <span className="sr-only" aria-hidden="true">
              {t('vidroIntro.title')}
            </span>
          </DialogPrimitive.Title>
          <PopupCard
            pages={[
              {
                eyebrow: t('vidroIntro.eyebrow'),
                title: t('vidroIntro.title'),
                body: t('vidroIntro.body'),
                imageUrl: dark ? IMAGE.dark : IMAGE.light,
              },
            ]}
            page={0}
            onPageChange={() => {}}
            ctaLabel={t('vidroIntro.continue')}
            ctaStyle="ink"
            secondaryLabel={t('vidroIntro.classic')}
            requireAck={false}
            sanitizeHref={sanitizeUrl}
            onCta={() => dismiss('continue')}
            onSecondary={goClassic}
            onClose={() => dismiss('close')}
            titleId={titleId}
            bodyId={bodyId}
          />
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
