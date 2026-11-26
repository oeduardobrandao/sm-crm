import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { X } from 'lucide-react';
import { siteLocaleForPath } from '@/content/siteLocale';
import { openConsentPreferences } from '@/lib/consent';
import { doNotSellOrShare } from '@/lib/usConsentDefault';
import { isNativeApp } from '@/native/platform';

const DISMISS_KEY = 'us_cookie_notice_dismissed';

const LINK_CLASS =
  'mb-0 cursor-pointer border-0 bg-transparent p-0 text-xs underline sm:text-sm [font:inherit]';

/**
 * US opt-out notice, mounted once in App.tsx next to <CookieConsent />. Shows only on `/en` pages,
 * where the US default is already stored (main.tsx), so it asks nothing: it says what runs and
 * offers "Do Not Sell or Share" and the preferences dialog. Dismissing it stores nothing about
 * consent, only that this browser has seen it.
 *
 * Client-only: it renders after mount, so the prerendered `/en` HTML never contains it and
 * hydration cannot mismatch. Storage is read in the effect, never during render.
 */
export default function UsCookieNotice() {
  const { t } = useTranslation();
  const usPage = siteLocaleForPath(useLocation().pathname) === 'en';
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!usPage || isNativeApp()) {
      setVisible(false);
      return;
    }
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISS_KEY) !== null;
    } catch {
      // Unreadable storage: show it; dismissing then lasts for this page view.
    }
    setVisible(!dismissed);
  }, [usPage]);

  if (!visible) return null;

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(DISMISS_KEY, new Date().toISOString());
    } catch {
      // Storage unavailable: hidden for this page view only.
    }
  };

  // The US default grants support, so the Crisp bubble (bottom right, 54px on phones and 60px plus
  // a 24px margin on wider screens) is on screen with the notice for nearly every visitor. The
  // right inset keeps the dismiss button out from under it.
  return (
    <section
      role="region"
      aria-label={t('cookies.banner.title')}
      className="cookie-banner fixed bottom-2.5 left-2.5 right-[76px] z-[9000] mx-auto flex max-w-3xl items-start gap-3 rounded-2xl border bg-card px-3 py-2.5 text-card-foreground shadow-lg sm:bottom-4 sm:left-4 sm:right-24 sm:items-center sm:px-5 sm:py-3"
    >
      <p className="flex-1 text-xs text-muted-foreground sm:text-sm">
        <span>{t('cookies.us.notice')}</span>{' '}
        <button type="button" className={LINK_CLASS} onClick={() => doNotSellOrShare()}>
          {t('cookies.us.doNotSell')}
        </button>
        {' · '}
        <button type="button" className={LINK_CLASS} onClick={() => openConsentPreferences()}>
          {t('cookies.us.settings')}
        </button>
      </p>
      <button
        type="button"
        aria-label={t('cookies.us.dismiss')}
        className="mb-0 flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0"
        onClick={dismiss}
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </section>
  );
}
