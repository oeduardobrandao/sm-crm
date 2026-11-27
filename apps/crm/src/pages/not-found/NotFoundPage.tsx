import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { isNativeApp } from '@/native/platform';

export default function NotFoundPage() {
  const { t } = useTranslation();
  useEffect(() => {
    document.title = t('notFound.documentTitle');
    const existing = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    const prev = existing?.getAttribute('content') ?? null;
    const el = existing ?? document.createElement('meta');
    if (!existing) {
      el.setAttribute('name', 'robots');
      document.head.appendChild(el);
    }
    el.setAttribute('content', 'noindex');
    return () => {
      if (prev === null) el.remove();
      else el.setAttribute('content', prev);
    };
  }, [t]);

  return (
    <div className="flex flex-col items-center justify-center h-screen text-center p-8 gap-4">
      <h1 className="text-2xl font-bold">{t('notFound.title')}</h1>
      <p className="text-muted-foreground">{t('notFound.body')}</p>
      <div className="flex gap-4">
        {/* The iOS app has no landing page: its home is the dashboard. */}
        <Link to={isNativeApp() ? '/dashboard' : '/'} className="underline">
          {t('notFound.home')}
        </Link>
        <Link to="/login" className="underline">
          {t('notFound.login')}
        </Link>
      </div>
    </div>
  );
}
