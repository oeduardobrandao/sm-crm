import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { OPEN_PREFERENCES_EVENT, setConsent, type ConsentCategory } from '@/lib/consent';
import { clearPendingSupportChat } from '@/lib/supportChat';
import { useConsent } from '@/lib/useConsent';
import { CookiePreferencesDialog } from './CookiePreferencesDialog';

/**
 * Mounted once in App.tsx. Owns both the first-visit banner (visible only while the visitor is
 * undecided) and the preferences dialog, which any "Preferências de cookies" link reopens via
 * openConsentPreferences() at any time.
 */
export default function CookieConsent() {
  const { t } = useTranslation();
  const consent = useConsent();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [focus, setFocus] = useState<ConsentCategory | undefined>();
  // The dialog has no Radix <Trigger> (any link on any page opens it by event), so Radix has nothing
  // to hand focus back to and it would fall to <body>. Remember the opener ourselves.
  const openerRef = useRef<HTMLElement | null>(null);
  const rememberOpener = () => {
    const el = document.activeElement;
    openerRef.current = el instanceof HTMLElement && el !== document.body ? el : null;
  };
  const restoreOpener = (event: Event) => {
    const el = openerRef.current;
    openerRef.current = null;
    if (el?.isConnected) {
      event.preventDefault();
      el.focus();
    }
  };

  useEffect(() => {
    const onOpen = (event: Event) => {
      rememberOpener();
      setFocus((event as CustomEvent<{ focus?: ConsentCategory }>).detail?.focus);
      setDialogOpen(true);
    };
    window.addEventListener(OPEN_PREFERENCES_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_PREFERENCES_EVENT, onOpen);
  }, []);

  const handleOpenChange = (open: boolean) => {
    setDialogOpen(open);
    // A dismissed dialog must not leave a chat-open request waiting for some later grant.
    if (!open) {
      clearPendingSupportChat();
      // Covers Save, Cancel, X, Esc and overlay click: a later open must not inherit the focus.
      setFocus(undefined);
    }
  };

  return (
    <>
      {consent === null && (
        <section
          role="region"
          aria-label={t('cookies.banner.title')}
          className="cookie-banner fixed inset-x-4 bottom-4 z-[9000] mx-auto max-w-3xl rounded-xl border bg-card p-4 text-card-foreground shadow-lg sm:flex sm:items-center sm:gap-4"
        >
          <div className="flex-1 text-sm">
            <p className="font-medium">{t('cookies.banner.title')}</p>
            <p className="text-muted-foreground">
              {t('cookies.banner.body')}{' '}
              <Link to="/lgpd" className="underline">
                {t('cookies.banner.learnMore')}
              </Link>
            </p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 sm:mt-0 sm:shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                rememberOpener();
                setFocus(undefined);
                setDialogOpen(true);
              }}
            >
              {t('cookies.banner.customize')}
            </Button>
            {/* Same variant on purpose: rejecting must not look less clickable than accepting. */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConsent({ analytics: false, support: false })}
            >
              {t('cookies.banner.rejectAll')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConsent({ analytics: true, support: true })}
            >
              {t('cookies.banner.acceptAll')}
            </Button>
          </div>
        </section>
      )}
      <CookiePreferencesDialog
        open={dialogOpen}
        onOpenChange={handleOpenChange}
        focus={focus}
        onCloseAutoFocus={restoreOpener}
      />
    </>
  );
}
